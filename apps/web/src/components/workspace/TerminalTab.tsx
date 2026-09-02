import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal as TerminalIcon, Play, RefreshCw, Loader2, LogOut } from '@/components/icons';
import { api } from '@/lib/api';

type TermStatus = { available: boolean; python: boolean; helper: boolean; hermes: boolean };
type Profile = { name: string; model: string; provider: string };

interface TerminalTabProps {
  /** Working directory the TUI should open in (the project's repo path). */
  cwd?: string;
}

/**
 * Embedded Hermes TUI — a real PTY bridged over WebSocket to an xterm.js pane.
 *
 * The server (apps/server/src/terminal) spawns `hermes --tui -p <profile>
 * --in <cwd>` inside a python pty and streams bytes here. Opening the tab
 * requires a profile pick + Launch; a status probe tells us up front whether
 * python3 / hermes are installed (with install help if not). Leaving the tab
 * (close) kills the session server-side.
 */
export function TerminalTab({ cwd }: TerminalTabProps) {
  const { t } = useTranslation();
  const mountRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);

  const [status, setStatus] = useState<TermStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profile, setProfile] = useState('');
  const [running, setRunning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setError(null);
    try {
      const r = await api.terminalStatus();
      setStatus(r.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void api.listHermesProfiles().then((r) => {
      setProfiles(r.profiles);
      if (r.profiles.length > 0) setProfile((p) => p || r.profiles[0].name);
    });
  }, [loadStatus]);

  // Clean shutdown on unmount: close the socket, which kills the PTY server-side.
  useEffect(() => {
    return () => {
      socketRef.current?.close();
      termRef.current?.dispose();
    };
  }, []);

  const ensureTerminal = useCallback(() => {
    const el = mountRef.current;
    if (!el) return null;
    if (termRef.current && termRef.current.element && termRef.current.element.isConnected) {
      return termRef.current;
    }
    // Lazy-import xterm so the code-split chunk only loads when the tab is used.
    return null;
  }, []);

  function openTerm(socket: WebSocket, cols: number, rows: number) {
    // Dynamic import of xterm + fit addon (kept out of the main bundle).
    void import('@xterm/xterm').then(async (mod) => {
      const el = mountRef.current;
      if (!el) return;
      const FitAddon = (await import('@xterm/addon-fit')).FitAddon;
      const term = new mod.Terminal({
        convertEol: true,
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: { background: '#0a0f1a', foreground: '#e2e8f0' },
        scrollback: 2000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fit.fit();
      termRef.current = term;
      fitRef.current = fit;

      // Initial size on the open frame.
      socket.send(JSON.stringify({ type: 'open', profile, cwd, cols, rows }));

      term.onData((data) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'input', data: btoa(unescape(encodeURIComponent(data))) }));
        }
      });

      const fitObserver = new ResizeObserver(() => {
        try { fit.fit(); } catch { /* */ }
      });
      fitObserver.observe(el);
      term.attachCustomKeyEventHandler?.((e) => {
        // Let Ctrl+C / Ctrl+L pass through to the PTY (browser default would steal them).
        if (e.ctrlKey && (e.key === 'c' || e.key === 'l')) return false;
        return true;
      });
    });
  }

  function launch() {
    if (connecting || running) return;
    setError(null);
    setConnecting(true);
    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${wsProto}://${location.host}/ws/terminal`);
    socketRef.current = socket;

    const cols = 80;
    const rows = 24;

    socket.onopen = () => {
      setConnecting(false);
      setRunning(true);
      openTerm(socket, cols, rows);
    };
    socket.onmessage = (ev) => {
      const term = termRef.current;
      if (!term) return;
      let msg: any;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === 'data' && typeof msg.data === 'string') {
        const text = decodeURIComponent(escape(atob(msg.data)));
        term.write(text);
      } else if (msg.type === 'err' && typeof msg.data === 'string') {
        term.writeln(`\x1b[31m[stderr] ${msg.data}\x1b[0m`);
      } else if (msg.type === 'exit') {
        term.writeln(`\x1b[33m[${t('terminal.processExited')}]\x1b[0m`);
        setRunning(false);
      } else if (msg.type === 'error') {
        term.writeln(`\x1b[31m[${msg.msg ?? t('terminal.error')}]\x1b[0m`);
        setRunning(false);
      }
    };
    socket.onerror = () => {
      setConnecting(false);
      setError(t('terminal.wsError'));
    };
    socket.onclose = () => {
      setConnecting(false);
      setRunning(false);
    };
  }

  function stop() {
    try {
      socketRef.current?.send(JSON.stringify({ type: 'close' }));
    } catch { /* */ }
    socketRef.current?.close();
    socketRef.current = null;
    termRef.current?.dispose();
    termRef.current = null;
    setRunning(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Controls */}
      <div className="mb-2 flex flex-col gap-1.5">
        <select
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          disabled={running || profiles.length === 0}
          className="w-full rounded-md border border-input bg-background px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {profiles.length === 0 && <option value="">{t('terminal.noProfiles')}</option>}
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} · {p.model ?? p.provider}
            </option>
          ))}
        </select>
        {!running ? (
          <button
            onClick={launch}
            disabled={connecting}
            className="flex w-full items-center justify-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {t('terminal.launch')}
          </button>
        ) : (
          <button
            onClick={stop}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-destructive/50 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-3 w-3" />
            {t('terminal.stop')}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</div>
      )}

      {/* Status / install help */}
      {!running && statusLoading && (
        <div className="mb-2 flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> {t('terminal.checking')}
        </div>
      )}
      {!running && status && !status.available && (
        <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs">
          <div className="mb-1 font-semibold text-amber-500">{t('terminal.missingTitle')}</div>
          <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
            {!status.python && <li>{t('terminal.missingPython')}</li>}
            {!status.helper && <li>{t('terminal.missingHelper')}</li>}
            {!status.hermes && <li>{t('terminal.missingHermes')}</li>}
          </ul>
          <div className="mt-1">{t('terminal.installHelp')}</div>
        </div>
      )}

      {/* xterm host */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/60 bg-[#0a0f1a]">
        <div ref={mountRef} className="h-full w-full" />
        {!running && !connecting && (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {t('terminal.idleHint')}
          </div>
        )}
      </div>
    </div>
  );
}

/** Probe the backend's terminal prerequisites (python3 + helper + hermes CLI). */
export function useTerminalStatus() {
  const [status, setStatus] = useState<TermStatus | null>(null);
  useEffect(() => {
    void api.terminalStatus().then((r) => setStatus(r.status));
  }, []);
  return status;
}
