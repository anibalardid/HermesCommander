import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LogsTab } from './LogsTab';
import { SourceControlTab, type SourceApi } from './SourceControlTab';
import { FilesTab, type FilesApi } from './FilesTab';
import { TerminalTab } from './TerminalTab';
import { ScrollText, GitBranch, Folder, Terminal, X } from '@/components/icons';
import type { AgentLogEntry, Task } from '@/lib/types';

type Tab = 'logs' | 'source' | 'files' | 'tui';

export type WorkspaceScope = 'mission' | 'project';

const STORAGE_KEY = 'hermes-commander.workspace.width';

// Width bounds in pixels (applies to desktop/tablet; mobile is full-width).
export const MIN_W = 260;
export const MAX_W = 720;
export const DESKTOP_DEFAULT = 320;

export function readSavedWidth(): number {
  const saved = Number(localStorage.getItem(STORAGE_KEY));
  return saved >= MIN_W && saved <= MAX_W ? saved : DESKTOP_DEFAULT;
}

export function saveWidth(w: number) {
  localStorage.setItem(STORAGE_KEY, String(w));
}

export function WorkspacePanel({
  open,
  onClose,
  scope,
  logs,
  sourceApi,
  filesApi,
  width,
  onWidthChange,
  cwd,
  tasks = [],
}: {
  open: boolean;
  onClose: () => void;
  scope: WorkspaceScope;
  logs?: AgentLogEntry[];
  sourceApi: SourceApi;
  filesApi: FilesApi;
  width: number;
  onWidthChange: (w: number) => void;
  /** Repo path the embedded TUI terminal opens in (project/workspace scope). */
  cwd?: string;
  /** Mission tasks — used by the source tab to pick which task's branch/worktree to show. */
  tasks?: Task[];
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('source');
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(width);
  // Detect mobile synchronously so the panel is full-width from the very first
  // render (avoids a flash of the fixed desktop width that overflows on phones).
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });

  // Track whether we're below the md breakpoint (768px). On mobile the panel is
  // a full-width overlay drawer; on md+ it's a fixed column with the resizable width.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Drag-to-resize via the left gutter. Delta-based so both widening and
  // narrowing work regardless of where the pointer starts.
  useEffect(() => {
    if (!open || isMobile) return;
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      // Gutter is on the LEFT edge: dragging left (dx negative) widens.
      const dx = e.clientX - startX.current;
      onWidthChange(Math.max(MIN_W, Math.min(MAX_W, startWidth.current - dx)));
    }
    function onUp() { dragging.current = false; }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [open, isMobile, onWidthChange]);

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    // Do NOT setPointerCapture here — it can swallow the window pointermove
    // listener and make one drag direction unreliable. The window listeners
    // (added in the effect) handle the whole drag.
  }, [width]);

  if (!open) return null;

  // Tab order: Source control, Files, Terminal, Logs (last). Missions show all
  // four; projects show Source + Files + Terminal (no logs).
  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [];
  tabs.push({ id: 'source', label: t('workspace.source'), icon: <GitBranch className="h-3.5 w-3.5" /> });
  tabs.push({ id: 'files', label: t('workspace.files'), icon: <Folder className="h-3.5 w-3.5" /> });
  tabs.push({ id: 'tui', label: t('workspace.tui'), icon: <Terminal className="h-3.5 w-3.5" /> });
  if (scope === 'mission') tabs.push({ id: 'logs', label: t('workspace.logs'), icon: <ScrollText className="h-3.5 w-3.5" /> });

  // If the active tab was removed (e.g. project has no logs), fall back to source.
  const activeTab = tabs.some((tb) => tb.id === tab) ? tab : 'source';

  return (
    <div
      className={`flex h-full shrink-0 flex-col border-l border-border bg-card ${
        isMobile ? 'absolute inset-0 z-[60]' : 'relative'
      }`}
      style={{ width: isMobile ? '100%' : width }}
    >
      {/* Resize gutter (desktop/tablet only) */}
      {!isMobile && (
        <div
          onPointerDown={handlePointerDown}
          className="absolute -left-1 top-0 z-20 h-full w-2 cursor-col-resize touch-none select-none"
          title={t('workspace.resize')}
        />
      )}

      {/* Header: tabs + close */}
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        {/* Desktop: horizontal tabs */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              title={tb.label}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors ${
                activeTab === tb.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="shrink-0">{tb.icon}</span>
              <span className="hidden truncate sm:inline">{tb.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          title={t('workspace.hide')}
          aria-label={t('workspace.hide')}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col p-2">
        {activeTab === 'logs' && <LogsTab logs={logs ?? []} tasks={tasks} />}
        {activeTab === 'source' && <SourceControlTab adapter={sourceApi} tasks={tasks} />}
        {activeTab === 'files' && <FilesTab adapter={filesApi} />}
        {activeTab === 'tui' && <TerminalTab cwd={cwd} />}
      </div>
    </div>
  );
}
