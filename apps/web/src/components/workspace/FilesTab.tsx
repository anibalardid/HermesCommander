import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import type { FileEntry } from '@/lib/types';
import { Folder, File, ChevronRight, Loader2 } from '@/components/icons';
import { FileViewer } from './FileViewer';

/** API surface the files tab needs — one implementation per scope (mission/project). */
export interface FilesApi {
  list: (path: string) => Promise<{ root: string; entries: FileEntry[] }>;
  read: (path: string) => Promise<{ content: string; truncated: boolean }>;
  write?: (path: string, content: string) => Promise<{ ok: boolean }>;
}

export function makeMissionFilesApi(missionId: string): FilesApi {
  return {
    list: (p) => api.listFiles(missionId, p),
    read: (p) => api.readFile(missionId, p),
    write: (p, c) => api.writeFile(missionId, p, c),
  };
}

export function makeProjectFilesApi(projectId: string): FilesApi {
  return {
    list: (p) => api.listProjectFiles(projectId, p),
    read: (p) => api.readProjectFile(projectId, p),
    write: (p, c) => api.writeProjectFile(projectId, p, c),
  };
}

export function FilesTab({ adapter }: { adapter: FilesApi }) {
  const { t } = useTranslation();
  const [cwd, setCwd] = useState('');                 // current relative dir
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [root, setRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<{ path: string; text: string; truncated: boolean; protected?: boolean } | null>(null);

  const load = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await adapter.list(dir);
      setRoot(r.root);
      setEntries(r.entries);
      setCwd(dir);
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => { void load(''); }, [load]);

  async function openFile(path: string, protected_ = false) {
    try {
      const r = await adapter.read(path);
      setContent({ path, text: r.content, truncated: r.truncated, protected: protected_ });
    } catch (e) {
      setContent({ path, text: (e as Error).message, truncated: false, protected: protected_ });
    }
  }

  // Breadcrumb segments from cwd.
  const segments = cwd ? cwd.split('/').filter(Boolean) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Breadcrumb (root is the top, can't go above it) */}
      <div className="mb-2 flex items-center gap-1 overflow-x-auto overflow-y-hidden text-[10px] text-muted-foreground">
        <button onClick={() => void load('')} className="shrink-0 rounded px-1 py-0.5 hover:bg-accent">
          {root ?? 'root'}
        </button>
        {segments.map((seg, i) => (
          <span key={i} className="flex shrink-0 items-center gap-1">
            <ChevronRight className="h-3 w-3" />
            <button
              onClick={() => void load(segments.slice(0, i + 1).join('/'))}
              className="rounded px-1 py-0.5 hover:bg-accent"
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {error && <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="icon-anim h-5 w-5 animate-spin" /></div>
        ) : entries.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">{t('workspace.emptyFolder')}</div>
        ) : (
          <div className="space-y-0.5">
            {entries.map((e) => (
              e.type === 'dir' ? (
                <button
                  key={e.path}
                  onClick={() => void load(e.path)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent"
                >
                  <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className={`min-w-0 flex-1 truncate ${e.name.startsWith('.') ? 'text-muted-foreground/70' : ''}`}>{e.name}</span>
                  {e.protected && <span className="shrink-0 text-[9px] uppercase text-amber-500">🔒</span>}
                </button>
              ) : (
                <button
                  key={e.path}
                  onClick={() => void openFile(e.path, e.protected)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent"
                >
                  <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className={`min-w-0 flex-1 truncate ${e.name.startsWith('.') ? 'text-muted-foreground/70' : ''}`}>{e.name}</span>
                  {e.protected && <span className="shrink-0 text-[9px] uppercase text-amber-500">🔒</span>}
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">{e.size > 0 ? `${(e.size / 1024).toFixed(1)}KB` : ''}</span>
                </button>
              )
            ))}
          </div>
        )}
      </div>

      {/* File viewer overlay — rendered via a portal to document.body so it
          escapes the workspace panel's stacking context (the panel is
          `absolute z-[60]` on mobile, which would otherwise trap the overlay
          below the app topbar). z-[100] keeps it above every app chrome. */}
      {content &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => setContent(null)}>
            <div className="flex h-[75vh] w-full max-w-3xl flex-col items-stretch justify-center" onClick={(e) => e.stopPropagation()}>
              <FileViewer
                content={content}
                adapter={{ write: content.protected ? undefined : adapter.write }}
                onClose={() => setContent(null)}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
