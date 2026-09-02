import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { Task } from '@/lib/types';
import { Loader2, GitPullRequest, ChevronRight, FileText, X, RefreshCw } from '@/components/icons';

/**
 * Modal to confirm a PR from a completed task's branch/worktree. Lets the user
 * pick/confirm the base branch, title and body, and preview the changed files
 * with a colorized diff before creating the PR.
 */
export function CreatePrModal({
  task,
  missionId,
  projectId,
  projectName,
  onClose,
  onCreated,
}: {
  task: Task;
  missionId: string;
  projectId: string | null;
  projectName: string | null;
  onClose: () => void;
  onCreated?: (url: string) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.description ?? '');
  const [bodyTouched, setBodyTouched] = useState(false);
  const [base, setBase] = useState(task.base_branch ?? ''); // default = PR head branch for fix tasks, else default base
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [files, setFiles] = useState<Array<{ path: string; code: string }>>([]);
  const [ahead, setAhead] = useState(0);
  const [branches, setBranches] = useState<string[]>([]);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const loadStatus = async () => {
    setStatusLoading(true);
    setError(null);
    try {
      const s = await api.getTaskSource(task.id);
      setFiles(s.files ?? []);
      setAhead(s.ahead ?? 0);
      const br = s.branches ?? [];
      // Exclude the task's own branch from the base choices.
      const taskBranch = task.branch;
      setBranches(br.map((b) => b.name).filter((n) => n !== taskBranch));
      // Auto-generate a structured PR body from the task description + the
      // changed files, unless the user already edited the body field.
      if (!bodyTouched) {
        const files = s.files ?? [];
        const parts: string[] = [];
        if (task.description?.trim()) parts.push(task.description.trim());
        if (files.length > 0) {
          parts.push(`## Changes\n\n${files.map((f) => `- \`${f.path}\``).join('\n')}`);
        }
        setBody(parts.join('\n\n'));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => { void loadStatus(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function loadFileDiff(file: string) {
    if (!selectedFile || selectedFile !== file) {
      setSelectedFile(file);
      setDiff(null);
      setDiffLoading(true);
      try {
        const { diff } = await api.getTaskDiff(task.id, file);
        setDiff(diff || null);
      } catch {
        setDiff(null);
      } finally {
        setDiffLoading(false);
      }
    }
  }

  async function doCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.createTaskPr(task.id, title.trim(), body.trim() || undefined, base || undefined);
      onClose();
      toast.success(t('toast.prCreated'));
      if (onCreated) onCreated(res.url);
    } catch (e) {
      setError(friendlyError((e as Error).message));
      toast.error(t('toast.error', { msg: (e as Error).message }));
      setCreating(false);
    }
  }

  /** Map raw backend/git errors to a friendly, human message. */
  function friendlyError(msg: string): string {
    const m = msg.toLowerCase();
    if (m.includes('same as base branch') || m.includes('no commits between')) {
      return t('workspace.prNoChangesError');
    }
    if (m.includes('no work directory')) {
      return t('workspace.prNoWorkdirError');
    }
    return msg;
  }

  const codeLabel = (code: string) =>
    code === 'M' ? t('workspace.modified') :
    code === 'A' || code === '??' ? t('workspace.added') :
    code === 'D' ? t('workspace.deleted') : code;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <GitPullRequest className="h-4 w-4 text-primary" /> {t('workspace.createPr')}
          </span>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Task / target info */}
          <div className="mb-3 rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{task.title}</span>
            {projectName && <span> · {projectName}</span>}
            {task.branch && (
              <span className="ml-2 font-mono text-[10px]">branch: {task.branch}</span>
            )}
          </div>

          {/* Title */}
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('workspace.prTitle')}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>

          {/* Body */}
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('workspace.prBody')}</span>
            <textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); setBodyTouched(true); }}
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>

          {/* Base branch */}
          <label className="mb-4 block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('workspace.baseBranch')}</span>
            <select
              value={base}
              onChange={(e) => setBase(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">{t('workspace.defaultBase')}</option>
              {branches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>

          {/* Files changed */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                <FileText className="mr-1 inline h-3.5 w-3.5" />
                {t('workspace.changes')} ({files.length})
              </span>
              <button onClick={() => void loadStatus()} className="rounded p-0.5 text-muted-foreground hover:bg-accent" title={t('workspace.refresh')}>
                <RefreshCw className={`icon-anim h-3 w-3 ${statusLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {statusLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border/60 p-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('common.loading')}
              </div>
            ) : files.length === 0 && ahead === 0 ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-600">
                {t('workspace.prNoChanges')}
              </div>
            ) : files.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">{t('workspace.clean')}</div>
            ) : (
              <div className="space-y-0.5">
                {files.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => void loadFileDiff(f.path)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent"
                  >
                    <span className={`shrink-0 font-mono ${f.code === 'D' ? 'text-red-400' : f.code === 'A' || f.code === '??' ? 'text-green-500' : 'text-muted-foreground'}`}>
                      {f.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{f.path}</span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                  </button>
                ))}
              </div>
            )}

            {/* Selected file diff */}
            {selectedFile && (
              <div className="mt-2 overflow-hidden rounded-md border border-border/50">
                <div className="flex items-center justify-between bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
                  <span className="truncate font-mono">{selectedFile}</span>
                  <button onClick={() => setSelectedFile(null)} className="rounded p-0.5 hover:bg-accent" aria-label="Close">×</button>
                </div>
                <div className="max-h-48 overflow-auto bg-black/90 font-mono text-[10px] leading-relaxed">
                  {diffLoading ? (
                    <div className="flex items-center justify-center gap-2 p-3 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> {t('common.loading')}
                    </div>
                  ) : diff ? (
                    diff.split('\n').map((line, i) => {
                      let cls = 'text-muted-foreground/70';
                      if (line.startsWith('+')) cls = 'bg-green-500/15 text-green-300';
                      else if (line.startsWith('-')) cls = 'bg-red-500/15 text-red-300';
                      else if (line.startsWith('@@')) cls = 'bg-violet-500/10 text-violet-300';
                      else if (line.startsWith('diff --git') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) cls = 'text-muted-foreground/60';
                      return (
                        <div key={i} className={`whitespace-pre px-2 ${cls}`}>{line || ' '}</div>
                      );
                    })
                  ) : (
                    <div className="p-3 text-xs text-muted-foreground">{t('workspace.noDiff')}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
          <button onClick={onClose} className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void doCreate()}
            disabled={creating || !title.trim() || (files.length === 0 && ahead === 0)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitPullRequest className="h-3.5 w-3.5" />}
            {t('workspace.createPr')}
          </button>
        </div>
      </div>
    </div>
  );
}
