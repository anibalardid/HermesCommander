import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
// pty-helper.py lives next to this module (apps/server/src/terminal/).
const PTY_HELPER = resolve(__dirname, 'pty-helper.py');

const procs = new Map<string, ChildProcess>();
let counter = 0;

type OpenParams = { profile?: string; cwd?: string; cols?: number; rows?: number };

function sendJson(socket: WebSocket, obj: unknown) {
  try { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(obj)); } catch { /* */ }
}

/**
 * Bridge a WebSocket to a real PTY via the python helper. The first client
 * frame must be `{ type:'open', profile?, cwd?, cols?, rows? }`; afterwards the
 * client speaks `{ type:'input'|'resize' }` and the server streams
 * `{ type:'data'|'err'|'exit'|'ready' }`.
 *
 * The PTY runs `hermes --tui -p <profile> --in <cwd>`. Closing the WS (leaving
 * the tab) kills the process.
 */
export function bridgeTerminalSocket(socket: WebSocket): void {
  let id = '';
  let child: ChildProcess | null = null;
  let started = false;
  // stdio[3] is the helper's resize control pipe (read "<cols> <rows>\n" on fd3).
  let resizeFd: import('node:stream').Writable | null = null;

  const killChild = () => {
    if (!child) return;
    try {
      child.kill('SIGTERM');
      setTimeout(() => { try { child?.kill('SIGKILL'); } catch { /* */ } }, 2000);
    } catch { /* already dead */ }
    child = null;
  };

  const start = (p: OpenParams): void => {
    const profile = p.profile || 'default';
    let cwd = p.cwd || process.env.HOME || '/tmp';
    if (cwd.startsWith('~')) cwd = cwd.replace('~', process.env.HOME || '/tmp');
    if (!existsSync(cwd)) cwd = process.env.HOME || '/tmp';

    const cols = Math.max(20, Math.min(500, Math.floor(p.cols ?? 80)));
    const rows = Math.max(5, Math.min(300, Math.floor(p.rows ?? 24)));

    const command = ['hermes', '-p', profile, '--in', cwd];
    child = spawn('python3', [PTY_HELPER, cwd, String(cols), String(rows), '--', ...command], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        COLUMNS: String(cols),
        LINES: String(rows),
      } as Record<string, string>,
      // stdio[3] = resize control pipe (the helper reads "<cols> <rows>\n" on fd3).
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });

    const fd3 = child.stdio[3];
    resizeFd = fd3 && 'write' in fd3 ? (fd3 as import('node:stream').Writable) : null;

    id = `tui-${Date.now()}-${counter++}`;
    procs.set(id, child);
    sendJson(socket, { type: 'ready', sessionId: id, profile, cwd, command: command.join(' ') });

    // Apply the initial size on the control pipe.
    resizeFd?.write(`${cols} ${rows}\n`);

    child.stdout?.on('data', (d: Buffer) => {
      sendJson(socket, { type: 'data', data: d.toString('base64') });
    });
    child.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) sendJson(socket, { type: 'err', data: msg });
    });
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      sendJson(socket, { type: 'exit', code, signal: signal ? String(signal) : undefined });
      procs.delete(id);
      child = null;
    };
    child.on('exit', onExit);
    child.on('error', (err) => {
      sendJson(socket, { type: 'error', msg: err.message });
    });

    const onFrame = (raw: unknown) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'input' && typeof msg.data === 'string') {
          child?.stdin?.write(Buffer.from(msg.data, 'base64'));
        } else if (msg.type === 'resize') {
          const c = Math.max(20, Math.min(500, Math.floor(msg.cols ?? cols)));
          const r = Math.max(5, Math.min(300, Math.floor(msg.rows ?? rows)));
          resizeFd?.write(`${c} ${r}\n`);
          if (child?.pid) { try { process.kill(child.pid, 'SIGWINCH'); } catch { /* */ } }
        } else if (msg.type === 'close') {
          killChild();
        }
      } catch { /* malformed frame */ }
    };

    socket.on('message', onFrame);
    socket.on('close', killChild);
    socket.on('error', killChild);
  };

  // First frame opens the PTY with its params.
  socket.on('message', function openHandler(raw) {
    let msg: { type?: string } & OpenParams;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === 'open') {
      socket.off('message', openHandler);
      started = true;
      start(msg);
    }
  });

  // If the client never sends 'open' (plain socket), spin up with defaults.
  setTimeout(() => {
    if (!started) {
      started = true;
      start({});
    }
  }, 500);
}

/** Kill every live terminal (server shutdown). */
export function destroyAllTerminals(): void {
  for (const proc of procs.values()) {
    try { proc.kill('SIGKILL'); } catch { /* */ }
  }
  procs.clear();
}
