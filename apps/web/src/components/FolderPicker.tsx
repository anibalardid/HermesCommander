import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import type { FsEntry } from '@/lib/types';
import { Folder, FolderGit2, ChevronRight, X, Loader2, Home, Plus } from '@/components/icons';

/**
 * Mobile-friendly folder picker. Instead of the native Finder/zenity dialog
 * (which doesn't work on phones), this browses the filesystem through the
 * backend (`GET /api/fs/browse`) with a breadcrumb + folder list — the same
 * interaction as the Files tab in the sidebar.
 */
export function FolderPicker({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [cwd, setCwd] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.browseFs(path);
      setCwd(r.path);
      setEntries(r.entries);
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!cwd || !name) return;
    setCreating(true);
    setError(null);
    try {
      const { path } = await api.mkdir(cwd, name);
      setNewFolderName('');
      await load(path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => { void load(); }, [load]);

  // Breadcrumb segments from cwd (absolute path).
  const segments = cwd ? cwd.split('/').filter(Boolean) : [];
  // Rebuild an absolute path from the first N segments (leading '/' restored).
  const pathUpTo = (n: number) => `/${segments.slice(0, n).join('/')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[6vh] sm:items-center sm:pt-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl sm:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <h2 className="text-lg font-bold">{t('project.pickFolder')}</h2>
          <button onClick={onClose} aria-label={t('common.close')} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
          <button onClick={() => void load()} className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-accent">
            <Home className="h-3 w-3" /> {t('project.home')}
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              <button
                onClick={() => void load(pathUpTo(i + 1))}
                className="rounded px-1 py-0.5 hover:bg-accent"
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {error && <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</div>}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : entries.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">{t('workspace.emptyFolder')}</div>
          ) : (
            <div className="space-y-0.5">
              {entries.map((e) => (
                e.type === 'dir' ? (
                  <button
                    key={e.path}
                    onClick={() => void load(e.path)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {e.isGitRepo ? (
                      <FolderGit2 className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0 text-primary" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    {e.isGitRepo && (
                      <span className="shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-[9px] font-medium text-green-600">
                        {e.branch ? `git · ${e.branch}` : 'git'}
                      </span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ) : (
                  <button
                    key={e.path}
                    onClick={() => onSelect(e.path)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.name}</span>
                  </button>
                )
              ))}
            </div>
          )}
        </div>

        {/* Footer: create new folder + select current folder */}
        <div className="space-y-2 border-t border-border/60 px-5 py-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void createFolder(); }}
              placeholder={t('project.newFolderPlaceholder')}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              onClick={() => void createFolder()}
              disabled={creating || !newFolderName.trim()}
              className="shrink-0 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
          </div>
          <button
            onClick={() => cwd && onSelect(cwd)}
            disabled={!cwd}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {t('project.selectThisFolder')}
          </button>
        </div>
      </div>
    </div>
  );
}
