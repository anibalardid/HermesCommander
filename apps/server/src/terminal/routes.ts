import type { FastifyInstance } from 'fastify';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bridgeTerminalSocket, destroyAllTerminals } from './sessions.js';
import { listHermesProfiles } from '../hermes/query.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PTY_HELPER = resolve(__dirname, 'pty-helper.py');

/** Whether the embedded-terminal prerequisites are met on the host. */
export function terminalStatus() {
  let pythonOk = false;
  try {
    pythonOk = !!spawnSync('python3', ['--version'], { timeout: 3000 }).stdout.toString().trim();
  } catch { pythonOk = false; }
  const helperExists = existsSync(PTY_HELPER);
  let hermesOk = false;
  try {
    hermesOk = spawnSync('hermes', ['--version'], { timeout: 3000 }).status === 0;
  } catch { hermesOk = false; }
  return {
    available: pythonOk && helperExists && hermesOk,
    python: pythonOk,
    helper: helperExists,
    hermes: hermesOk,
  };
}

/** Terminal + TUI routes: availability probe and a WebSocket that bridges a
 * real PTY (via the python helper) to an xterm.js client in the browser. */
export function registerTerminalRoutes(app: FastifyInstance): void {
  app.get('/api/terminal/status', async () => ({ status: terminalStatus() }));
  app.get('/api/terminal/profiles', async () => ({ profiles: await listHermesProfiles() }));

  // WebSocket: each connection owns one PTY process; closing the socket kills
  // it (kill-on-leave). The client sends {type:'open',profile?,cwd?,cols?,rows?}
  // as its first frame. Uses the same direct-socket pattern as the /ws hub.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).get('/ws/terminal', { websocket: true }, (socket: import('ws').WebSocket) => {
    bridgeTerminalSocket(socket);
  });

  // On server shutdown, kill every lingering PTY.
  process.once('SIGTERM', () => destroyAllTerminals());
}
