import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { Task } from '@/lib/types';
import { GitPullRequest, Loader2, GitCommit, Upload } from '@/components/icons';

/**
 * Action button for a done task's source work.
 *
 * Resolves what to offer based on the task's source status:
 *  - an existing open PR for the branch (from task.pr_url or the source's pr)
 *    -> "View PR" that navigates to the in-app PR detail
 *  - has changes AND its own branch/worktree  -> "Create PR" (opens the PR modal)
 *  - has changes but NO own branch (inherits the project's branch) -> "Commit & Push"
 *  - no changes AND no PR -> a small "no changes" notice (no button)
 */
export function CreatePrButton({
  task,
  onOpen,
  variant = 'icon',
}: {
  task: Task;
  onOpen: (task: Task) => void;
  variant?: 'icon' | 'full';
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'pr' | 'commit' | 'none'>('loading');
  const [existingPr, setExistingPr] = useState<{ number: number; projectId: string | null } | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const hasOwnBranch = !!task.worktree_path || !!task.branch;

  // Resolve the "view PR" target: prefer the persisted pr_url (task.pr_url),
  // otherwise fall back to an open PR detected on the branch via the source.
  const prNumber = task.review_pr_number ?? existingPr?.number ?? null;
  const prProjectId = task.review_pr_project_id ?? existingPr?.projectId ?? null;
  const canViewPr = !!task.pr_url || !!prNumber;

  useEffect(() => {
    let alive = true;
    api.getTaskSource(task.id)
      .then((s) => {
        if (!alive) return;
        if (s.pr) setExistingPr({ number: s.pr.number, projectId: s.pr.projectId ?? null });
        const hasChanges = (s.files?.length ?? 0) > 0 || (s.ahead ?? 0) > 0;
        const hasPr = canViewPr || !!s.pr;
        if (hasPr) setState('none'); // PR exists → the View-PR link replaces the button
        else if (!hasChanges) setState('none');
        else setState(hasOwnBranch ? 'pr' : 'commit');
      })
      .catch(() => { if (alive) setState(hasOwnBranch ? 'pr' : 'commit'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, hasOwnBranch, canViewPr]);

  function goToPr(e: React.MouseEvent) {
    e.stopPropagation();
    if (prNumber && prProjectId) {
      navigate(`/pr/${prProjectId}/${prNumber}`);
    } else if (task.pr_url) {
      window.open(task.pr_url, '_blank', 'noopener');
    }
  }

  async function doCommitPush() {
    if (!commitMsg.trim() || busy) return;
    setBusy(true);
    try {
      await api.taskCommit(task.id, commitMsg.trim());
      await api.taskPush(task.id);
      setCommitOpen(false);
      setCommitMsg('');
      toast.success(t('toast.committedPushed'));
    } catch (e) {
      toast.error(t('toast.error', { msg: (e as Error).message }));
      return;
    } finally {
      setBusy(false);
    }
  }

  // Existing PR → show a "View PR" button that links to the in-app PR detail.
  if (canViewPr) {
    return variant === 'full' ? (
      <button
        onClick={goToPr}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
      >
        <GitPullRequest className="icon-anim h-4 w-4" /> {t('task.openPr')}
      </button>
    ) : (
      <button
        onClick={goToPr}
        title={t('task.openPr')}
        aria-label={t('task.openPr')}
        className="shrink-0 rounded-md border border-primary/40 bg-primary/5 p-1.5 text-primary transition-all hover:bg-primary/15 active:scale-90"
      >
        <GitPullRequest className="icon-anim h-3.5 w-3.5" />
      </button>
    );
  }

  if (state === 'loading') {
    return <Loader2 className="icon-anim h-3.5 w-3.5 animate-spin text-muted-foreground" />;
  }

  if (state === 'none') {
    return (
      <span
        className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[10px] font-medium text-amber-600"
        title={t('workspace.prNoChanges')}
      >
        {t('workspace.prNoChangesShort')}
      </span>
    );
  }

  if (state === 'commit') {
    return (
      <>
        <button
          onClick={(e) => { e.stopPropagation(); setCommitOpen(true); }}
          title={t('workspace.commitPush')}
          aria-label={t('workspace.commitPush')}
          className="shrink-0 rounded-md border border-primary/40 bg-primary/5 p-1.5 text-primary transition-all hover:bg-primary/15 active:scale-90"
        >
          <GitCommit className="icon-anim h-3.5 w-3.5" />
        </button>
        {commitOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCommitOpen(false)}>
            <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="mb-1 text-sm font-semibold">{t('workspace.commitPush')}</h3>
              <p className="mb-3 text-xs text-muted-foreground">{t('workspace.commitPushHint')}</p>
              <textarea
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder={t('workspace.commitPlaceholder')}
                rows={2}
                className="mb-3 w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setCommitOpen(false)}
                  className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => void doCommitPush()}
                  disabled={!commitMsg.trim() || busy}
                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  {t('workspace.commitPush')}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (variant === 'full') {
    return (
      <button
        onClick={() => onOpen(task)}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
      >
        <GitPullRequest className="icon-anim h-4 w-4" /> {t('task.createPr')}
      </button>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(task); }}
      title={t('task.createPr')}
      aria-label={t('task.createPr')}
      className="shrink-0 rounded-md border border-primary/40 bg-primary/5 p-1.5 text-primary transition-all hover:bg-primary/15 active:scale-90 disabled:opacity-60"
    >
      <GitPullRequest className="icon-anim h-3.5 w-3.5" />
    </button>
  );
}
