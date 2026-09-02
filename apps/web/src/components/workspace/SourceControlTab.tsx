import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { SourceStatus, WorktreeInfo, BranchInfo, CommitInfo, Task } from '@/lib/types';
import { GitBranch, GitPullRequest, Loader2, RefreshCw, Upload, GitCommit, X, ChevronRight, ExternalLink, RotateCcw } from '@/components/icons';
import { SearchableSelect } from '@/components/SearchableSelect';
import { DiffModal } from '@/components/DiffModal';
import { githubRepoUrl } from '@/lib/utils';

/** API surface the source-control tab needs — one implementation per scope (mission/project). */
export interface SourceApi {
  /** The project id owning this repo — used to link PRs to their detail page. */
  projectId: string;
  getStatus: () => Promise<SourceStatus & { worktrees?: WorktreeInfo[]; branches?: BranchInfo[] }>;
  commit: (message: string) => Promise<{ sha: string }>;
  push: () => Promise<{ ok: boolean }>;
  revert: () => Promise<{ ok: boolean }>;
  createPr: (title: string, body?: string) => Promise<{ url: string }>;
  diff: (file: string) => Promise<{ diff: string }>;
  checkout: (branch: string) => Promise<{ ok: boolean; branch: string }>;
  commits: () => Promise<{ commits: CommitInfo[] }>;
}

export function makeMissionSourceApi(missionId: string, projectId: string): SourceApi {
  return {
    projectId,
    getStatus: () => api.getSourceStatus(missionId),
    commit: (m) => api.sourceCommit(missionId, m),
    push: () => api.sourcePush(missionId),
    revert: () => api.sourceRevert(missionId),
    createPr: (t, b) => api.sourceCreatePr(missionId, t, b),
    diff: (f) => api.sourceDiff(missionId, f),
    checkout: (b) => api.sourceCheckout(missionId, b),
    commits: () => api.sourceCommits(missionId),
  };
}

export function makeProjectSourceApi(projectId: string): SourceApi {
  return {
    projectId,
    getStatus: () => api.getProjectSource(projectId),
    commit: (m) => api.projectCommit(projectId, m),
    push: () => api.projectPush(projectId),
    revert: () => api.projectRevert(projectId),
    createPr: (t, b) => api.projectCreatePr(projectId, t, b),
    diff: (f) => api.projectDiff(projectId, f),
    checkout: (b) => api.projectCheckout(projectId, b),
    commits: () => api.projectCommits(projectId),
  };
}

/** Source API scoped to a single task's worktree/branch. Used by the mission
 *  source tab so the changed files reflect the SELECTED task, not the whole
 *  mission. */
export function makeTaskSourceApi(taskId: string, projectId: string): SourceApi {
  return {
    projectId,
    getStatus: () => api.getTaskSource(taskId),
    commit: (m) => api.taskCommit(taskId, m),
    push: () => api.taskPush(taskId),
    revert: () => api.taskRevert(taskId),
    createPr: (t, b) => api.createTaskPr(taskId, t, b),
    diff: (f) => api.getTaskDiff(taskId, f),
    checkout: (b) => api.taskCheckout(taskId, b),
    commits: () => api.taskCommits(taskId),
  };
}

export function SourceControlTab({ adapter, tasks = [] }: { adapter: SourceApi; tasks?: Task[] }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SourceStatus & { worktrees?: WorktreeInfo[]; branches?: BranchInfo[] } | null>(null);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // 'commit' | 'push' | 'pr'
  const [diff, setDiff] = useState<string | null>(null); // currently shown diff
  const [selectedFile, setSelectedFile] = useState<string | null>(null); // file whose diff is shown inline
  const [prOpen, setPrOpen] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [revertConfirm, setRevertConfirm] = useState(false);
  const [tab, setTab] = useState<'changes' | 'commits' | 'prs'>('changes');
  // Selected task id (mission scope). When the mission has >1 task, the top
  // combobox picks the task and we show its branch/worktree + changes below.
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');

  // Default to the first parent task when the list loads (mission scope).
  useEffect(() => {
    const parents = tasks.filter((x) => !x.parent_id);
    if (parents.length > 0 && !selectedTaskId) setSelectedTaskId(parents[0].id);
  }, [tasks, selectedTaskId]);

  const selectedTask = tasks.find((x) => x.id === selectedTaskId) ?? null;
  // Only parent tasks (no subtasks) are selectable in the source tab.
  const parentTasks = tasks.filter((x) => !x.parent_id);

  // When a task is selected (mission scope), scope the source API to that
  // task's worktree/branch so the changed files reflect the SELECTED task,
  // not the whole mission. Fall back to the mission adapter otherwise.
  // Memoized so load/loadCommits (which depend on it) stay stable across
  // renders — otherwise the fetch effect below would loop forever.
  const activeAdapter: SourceApi = useMemo(
    () => (selectedTask ? makeTaskSourceApi(selectedTask.id, adapter.projectId) : adapter),
    [selectedTask, adapter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await activeAdapter.getStatus();
      setStatus(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeAdapter]);

  const loadCommits = useCallback(async () => {
    try {
      const { commits } = await activeAdapter.commits();
      setCommits(commits);
    } catch { /* ignore */ }
  }, [activeAdapter]);

  useEffect(() => {
    void load();
    void loadCommits();
  }, [load, loadCommits]);

  async function doCommit() {
    if (!commitMsg.trim() || busy) return;
    setBusy('commit');
    setError(null);
    try {
      await activeAdapter.commit(commitMsg.trim());
      setCommitMsg('');
      toast.success(t('toast.committed'));
      await load();
    } catch (e) {
      setError((e as Error).message);
      toast.error(t('toast.error', { msg: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  async function doPush() {
    if (busy) return;
    setBusy('push');
    setError(null);
    try {
      await activeAdapter.push();
      toast.success(t('toast.pushed'));
      await load();
    } catch (e) {
      setError((e as Error).message);
      toast.error(t('toast.error', { msg: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  async function doRevert() {
    if (busy) return;
    setBusy('revert');
    setError(null);
    try {
      await activeAdapter.revert();
      setRevertConfirm(false);
      setSelectedFile(null);
      setDiff(null);
      toast.success(t('toast.reverted'));
      await load();
    } catch (e) {
      setError((e as Error).message);
      toast.error(t('toast.error', { msg: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  async function openDiff(file: string) {
    // Toggle: clicking the same file again closes the diff.
    if (selectedFile === file) {
      setSelectedFile(null);
      setDiff(null);
      return;
    }
    setSelectedFile(file);
    setDiff(null);
    try {
      const { diff } = await activeAdapter.diff(file);
      setDiff(diff || '—');
    } catch (e) {
      setDiff((e as Error).message);
    }
  }

  async function doPr() {
    if (!prTitle.trim() || busy) return;
    setBusy('pr');
    setError(null);
    try {
      await activeAdapter.createPr(prTitle.trim(), prBody.trim() || undefined);
      setPrOpen(false);
      setPrTitle('');
      setPrBody('');
      toast.success(t('toast.prCreated'));
      await load();
    } catch (e) {
      setError((e as Error).message);
      toast.error(t('toast.error', { msg: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  async function doCheckout(branch: string) {
    if (busy) return;
    setBusy('checkout');
    setError(null);
    try {
      await activeAdapter.checkout(branch);
      toast.success(t('toast.checkedOut'));
      await load();
    } catch (e) {
      setError((e as Error).message);
      toast.error(t('toast.error', { msg: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  const codeLabel = (c: string) =>
    c === 'M' ? t('workspace.modified') :
    c === 'A' || c === '??' ? t('workspace.added') :
    c === 'D' ? t('workspace.deleted') : c;

  function formatCommitDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="icon-anim h-5 w-5 animate-spin" /></div>;
  }
  if (!status) {
    return <div className="py-6 text-center text-xs text-muted-foreground">{error || t('common.empty')}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{error}</div>}

      {/* Tabs: Changes / Pull Request / Commits */}
      <div className="mb-2 flex items-center gap-1 border-b border-border/60">
        {([
          { id: 'changes', label: t('workspace.changes'), count: status.files.length },
          { id: 'prs', label: t('workspace.pullRequest'), count: status.prs.length },
          { id: 'commits', label: t('workspace.commits'), count: commits.length },
        ] as const).map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-medium transition-colors ${
              tab === tb.id
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tb.label}
            {tb.count > 0 && (
              <span className={`rounded-full px-1.5 text-[10px] ${tab === tb.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                {tb.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Changes tab */}
        {tab === 'changes' && (
          <>
            {/* Task selector (mission scope) — only inside Changes. Pick the task
                to see its branch/worktree and the changes it produced. For a
                project scope (no tasks) we fall back to the branch combobox. */}
            {parentTasks.length > 0 ? (
              <div className="mb-2">
                <SearchableSelect
                  value={selectedTaskId}
                  onChange={(id) => setSelectedTaskId(id)}
                  disabled={!!busy}
                  options={parentTasks.map((x) => ({ value: x.id, label: x.title }))}
                  placeholder={t('workspace.selectTask')}
                  className="w-full"
                />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="truncate font-mono">
                      {selectedTask?.branch ?? selectedTask?.worktree_path ?? status.branch ?? t('workspace.noBranch')}
                    </span>
                    {(status.ahead > 0 || status.behind > 0) && (
                      <span className="shrink-0">↑{status.ahead}↓{status.behind}</span>
                    )}
                  </div>
                  <button onClick={() => void load()} title={t('workspace.refresh')} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
                    <RefreshCw className="icon-anim h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="mb-2">
                <SearchableSelect
                  value={status.branch ?? ''}
                  onChange={(b) => void doCheckout(b)}
                  disabled={!!busy}
                  options={(status.branches ?? []).map((b) => ({ value: b.name, label: b.name }))}
                  placeholder={t('workspace.noBranch')}
                  className="w-full"
                />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="truncate font-mono">{status.branch ?? t('workspace.noBranch')}</span>
                    {(status.ahead > 0 || status.behind > 0) && (
                      <span className="shrink-0">↑{status.ahead}↓{status.behind}</span>
                    )}
                  </div>
                  <button onClick={() => void load()} title={t('workspace.refresh')} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
                    <RefreshCw className="icon-anim h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {status.files.length === 0 ? (
              <div className="mb-2 rounded border border-dashed border-border/60 p-2 text-xs text-muted-foreground/70">{t('workspace.clean')}</div>
            ) : (
              <div className="space-y-0.5">
                {status.files.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => void openDiff(f.path)}
                    className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent ${
                      selectedFile === f.path ? 'bg-primary/10 ring-1 ring-inset ring-primary/40 hover:bg-primary/10' : ''
                    }`}
                  >
                    <span className={`shrink-0 font-mono ${f.code === 'D' ? 'text-red-400' : f.code === 'A' || f.code === '??' ? 'text-green-500' : f.staged ? 'text-green-500' : 'text-muted-foreground'}`}>
                      {f.code}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{f.path}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Commit / push / PR actions — only in the Changes tab.
                Disabled entirely when there are no changes to commit. */}
            <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
              <textarea
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder={t('workspace.commitPlaceholder')}
                rows={2}
                disabled={status.files.length === 0}
                className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => void doCommit()}
                  disabled={!commitMsg.trim() || !!busy || status.files.length === 0}
                  className="flex min-w-[6rem] flex-1 items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy === 'commit' ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCommit className="h-3 w-3" />}
                  {t('workspace.commit')}
                </button>
                <button
                  onClick={() => void doPush()}
                  disabled={!!busy || status.files.length === 0}
                  className="flex min-w-[6rem] flex-1 items-center justify-center gap-1 rounded-md border border-input px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                >
                  {busy === 'push' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  {t('workspace.push')}
                </button>
              </div>
              {status.ghAvailable && status.baseBranch && status.branch === status.baseBranch ? (
                <button
                  onClick={() => setRevertConfirm(true)}
                  disabled={!!busy || status.files.length === 0}
                  className="flex w-full items-center justify-center gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  {busy === 'revert' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  {t('workspace.revertChanges')}
                </button>
              ) : status.ghAvailable ? (
                <button
                  onClick={() => setPrOpen(true)}
                  disabled={!!busy || status.files.length === 0}
                  className="flex w-full items-center justify-center gap-1 rounded-md border border-input px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                >
                  {busy === 'pr' ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitPullRequest className="h-3 w-3" />}
                  {t('workspace.createPr')}
                </button>
              ) : null}
            </div>

            {/* Revert confirmation dialog */}
            {revertConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setRevertConfirm(false)}>
                <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <h3 className="mb-1 text-sm font-semibold">{t('workspace.revertTitle')}</h3>
                  <p className="mb-3 text-xs text-muted-foreground">{t('workspace.revertMsg')}</p>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setRevertConfirm(false)}
                      className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={() => void doRevert()}
                      disabled={busy === 'revert'}
                      className="flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                    >
                      {busy === 'revert' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                      {t('workspace.revertChanges')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Commits tab */}
        {tab === 'commits' && (
          <>
            {commits.length === 0 ? (
              <div className="mb-2 rounded border border-dashed border-border/60 p-2 text-xs text-muted-foreground/70">{t('workspace.noCommits')}</div>
            ) : (
              <div className="space-y-1">
                {commits.map((c) => {
                  const repoBase = githubRepoUrl(status?.remoteUrl);
                  const commitUrl = repoBase ? `${repoBase}/commit/${c.sha}` : null;
                  return (
                  <div key={c.sha} className="rounded-md px-1.5 py-1.5 hover:bg-accent/40">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground">{c.shortSha}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs">{c.message}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {c.author} · {formatCommitDate(c.date)}
                        </div>
                      </div>
                      {commitUrl && (
                        <a
                          href={commitUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          title={t('workspace.openCommit')}
                          aria-label={t('workspace.openCommit')}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {c.files.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 pl-6">
                        {c.files.slice(0, 6).map((f) => (
                          <span key={f.path} className="inline-flex items-center gap-1 rounded border border-border/50 bg-muted/30 px-1 py-0.5 text-[9px] text-muted-foreground">
                            <span className={f.code === 'A' ? 'text-green-500' : f.code === 'D' ? 'text-red-400' : 'text-muted-foreground'}>
                              {f.code}
                            </span>
                            <span className="max-w-[10rem] truncate">{f.path}</span>
                          </span>
                        ))}
                        {c.files.length > 6 && (
                          <span className="text-[9px] text-muted-foreground">+{c.files.length - 6} más</span>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* PRs tab */}
        {tab === 'prs' && (
          <>
            {status.ghAvailable ? (
              status.prs.length === 0 ? (
                <div className="space-y-2">
                  <div className="rounded-md border border-dashed border-border/60 p-3 text-center">
                    <div className="text-xs font-medium text-foreground">{t('workspace.noPrs')}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {status.branch ? `refs/heads/${status.branch}` : ''} {t('workspace.prNotLinked')}
                    </div>
                    <button
                      onClick={() => setPrOpen(true)}
                      disabled={!!busy}
                      className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      <GitPullRequest className="h-3 w-3" /> {t('workspace.createPr')}
                    </button>
                    <div className="mt-1.5 text-[10px] text-muted-foreground">
                      <button onClick={() => setPrOpen(true)} className="text-primary hover:underline">
                        {t('workspace.linkExistingPr')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {status.prs.map((p) => (
                    <Link
                      key={p.number}
                      to={`/pr/${adapter.projectId}/${p.number}`}
                      className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-primary hover:bg-accent"
                    >
                      <GitPullRequest className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">#{p.number} {p.title}</span>
                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              )
            ) : (
              <div className="text-[10px] text-muted-foreground/70">{t('workspace.ghNotInstalled')}</div>
            )}
          </>
        )}
      </div>

      {/* Create PR dialog */}
      {prOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPrOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-2xl sm:max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">{t('workspace.createPr')}</span>
              <button onClick={() => setPrOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              placeholder={t('workspace.prTitle')}
              className="mb-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <textarea
              value={prBody}
              onChange={(e) => setPrBody(e.target.value)}
              placeholder={t('workspace.prBody')}
              rows={4}
              className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setPrOpen(false)} className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void doPr()}
                disabled={!prTitle.trim() || !!busy}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t('workspace.createPr')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File diff modal — opens when a changed file is clicked (same style as the PR page) */}
      <DiffModal file={selectedFile} diff={diff} onClose={() => { setSelectedFile(null); setDiff(null); }} />
    </div>
  );
}
