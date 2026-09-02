import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, ExternalLink, GitBranch, GitMerge, GitPullRequestClosed, Loader2, RefreshCw,
  MessageCircle, FolderKanban, AlertTriangle, Check, Copy, Plus, ChevronDown, ChevronRight,
} from '@/components/icons';
import { api } from '@/lib/api';
import { useStore } from '@/store';
import { toast } from '@/lib/toast';
import { NotificationBell } from '@/components/NotificationBell';
import type { GithubPrDetail, SubagentRecipe } from '@/lib/types';
import { Button } from '@/components/ui';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DiffModal } from '@/components/DiffModal';
import { Markdown } from '@/components/Markdown';

const STATE_META: Record<string, { label: string; cls: string }> = {
  OPEN: { label: 'Open', cls: 'bg-green-500/15 text-green-600' },
  DRAFT: { label: 'Draft', cls: 'bg-muted text-muted-foreground' },
  MERGED: { label: 'Merged', cls: 'bg-purple-500/15 text-purple-600' },
  CLOSED: { label: 'Closed', cls: 'bg-red-500/15 text-red-600' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

export function PrDetailView() {
  const { projectId, number } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [pr, setPr] = useState<GithubPrDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [copied, setCopied] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'conversation' | 'files'>('conversation');
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  // Pending destructive action awaiting confirmation: 'merge' | 'squash' | 'close' | null.
  const [confirmAction, setConfirmAction] = useState<'merge' | 'squash' | 'close' | null>(null);
  // Whether to also delete the branch (local + remote) after merging.
  const [deleteBranch, setDeleteBranch] = useState(false);

  const load = () => {
    if (!projectId || !number) return;
    setLoading(true);
    setError(null);
    api.getPrDetail(projectId, parseInt(number, 10))
      .then((r) => setPr(r.pr))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, number]);

  async function doMerge(method: string) {
    if (!projectId || !number || busy) return;
    setBusy(`merge:${method}`); setNote(null);
    try {
      await api.mergePr(projectId, parseInt(number, 10), method, deleteBranch);
      toast.success(method === 'squash' ? t('toast.squashed') : t('toast.merged'));
      load();
    } catch (e) { toast.error(t('toast.error', { msg: (e as Error).message })); }
    finally { setBusy(null); }
  }

  async function doSetState(closed: boolean) {
    if (!projectId || !number || busy) return;
    setBusy(closed ? 'close' : 'reopen'); setNote(null);
    try {
      await api.setPrState(projectId, parseInt(number, 10), closed);
      toast.success(closed ? t('toast.prClosed') : t('toast.prReopened'));
      load();
    } catch (e) { toast.error(t('toast.error', { msg: (e as Error).message })); }
    finally { setBusy(null); }
  }

  async function doComment() {
    if (!projectId || !number || !comment.trim() || busy) return;
    setBusy('comment'); setNote(null);
    try {
      await api.addPrComment(projectId, parseInt(number, 10), comment.trim());
      setComment('');
      toast.success(t('toast.commentPosted'));
      load();
    } catch (e) { toast.error(t('toast.error', { msg: (e as Error).message })); }
    finally { setBusy(null); }
  }

  async function doWorktree() {
    if (!projectId || !number || !pr?.branch || busy) return;
    setBusy('worktree'); setNote(null);
    try {
      await api.createWorktreeFromPr(projectId, parseInt(number, 10), pr.branch);
      toast.success(t('toast.worktreeCreated'));
    } catch (e) { toast.error(t('toast.error', { msg: (e as Error).message })); }
    finally { setBusy(null); }
  }

  // Load the PR diff and select a single file's hunk for the colorized view.
  async function loadFileDiff(file: string) {
    if (!projectId || !number) return;
    setSelectedFile(file);
    setDiffLoading(true);
    setFileDiff(null);
    try {
      const { diff } = await api.getPrDiff(projectId, parseInt(number, 10));
      // Split by "diff --git" headers and pick the block for the target file.
      const blocks = diff.split(/(?=^diff --git )/m);
      const block = blocks.find((b) => b.includes(`b/${file}`)) ?? diff;
      setFileDiff(block);
    } catch {
      setFileDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }

  async function doCopyLink() {
    if (!pr?.url) return;
    try {
      await navigator.clipboard.writeText(pr.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  if (loading && !pr) return <Loading />;
  if (error && !pr) return <div className="p-8 text-center text-sm text-red-500">{error}</div>;
  if (!pr) return <Loading />;

  const meta = STATE_META[pr.state] ?? STATE_META.OPEN;
  const canAct = pr.state === 'OPEN' || pr.state === 'DRAFT';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <button onClick={() => navigate('/tasks')} className="rounded-md p-1 hover:bg-accent" aria-label={t('common.back')}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-bold leading-tight">{pr.title}</h1>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <button
              onClick={() => navigate(`/project/${projectId}`)}
              className="font-medium text-foreground hover:underline"
              title={t('office.projectNameLink')}
            >
              {pr.projectName}
            </button>
            {' · '}<span className="font-mono">#{pr.number}</span>
            {pr.author ? ` · ${pr.author}` : ''}
          </p>
        </div>
        <button onClick={load} className="rounded-md p-2 text-muted-foreground hover:bg-accent" title="Refresh" aria-label="Refresh">
          <RefreshCw className={`icon-anim h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <NotificationBell />
      </header>

      {/* Merge conflict banner — prominent warning when the PR can't merge */}
      {pr.mergeable === 'CONFLICTING' && (
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="text-sm font-semibold text-destructive">{t('pr.conflict')}</span>
          <span className="text-xs text-destructive/80">{t('pr.conflictDetail')}</span>
        </div>
      )}

      {/* Actions + metadata row */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        {pr.branch && (
          <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            <GitBranch className="h-3 w-3" />{pr.branch}
          </span>
        )}
        {pr.base && (
          <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            → {pr.base}
          </span>
        )}
        {pr.additions !== null && pr.deletions !== null && (
          <span className="text-[11px] text-muted-foreground">
            <span className="text-green-600">+{pr.additions}</span> <span className="text-red-600">−{pr.deletions}</span>
          </span>
        )}
        {pr.updatedAt && <span className="text-[11px] text-muted-foreground">{formatDate(pr.updatedAt)}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {canAct && (
            <>
              <button
                onClick={() => setReviewOpen(true)}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-3 w-3" />
                {t('office.createTask')}
              </button>
              <button
                onClick={() => void doWorktree()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy === 'worktree' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderKanban className="h-3 w-3" />}
                Worktree
              </button>
              <button
                onClick={() => setConfirmAction('merge')}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                title="Merge commit"
              >
                {busy === 'merge:merge' ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitMerge className="h-3 w-3" />}
                Merge
              </button>
              <button
                onClick={() => setConfirmAction('squash')}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                title="Squash merge"
              >
                {busy === 'merge:squash' ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitMerge className="h-3 w-3" />}
                Squash
              </button>
              <button
                onClick={() => setConfirmAction('close')}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
              >
                {busy === 'close' ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitPullRequestClosed className="h-3 w-3" />}
                Close
              </button>
            </>
          )}
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            <ExternalLink className="h-3 w-3" /> GitHub
          </a>
          <button
            onClick={() => void doCopyLink()}
            title={copied ? 'Copied' : 'Copy GitHub link'}
            aria-label="Copy GitHub link"
            className="inline-flex items-center rounded-md border border-border/60 p-2 text-muted-foreground hover:bg-accent"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Feedback note */}
      {note && (
        <div className={`flex items-center gap-2 border-b px-4 py-1.5 text-xs ${note.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>
          {note.startsWith('Error') ? <AlertTriangle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {note}
        </div>
      )}

      {/* Tabs: Conversation | Files changed */}
      <div className="flex items-center gap-1 border-b px-4 pt-2">
        <button
          onClick={() => setActiveTab('conversation')}
          className={`rounded-t-md px-3 py-2 text-sm font-medium ${activeTab === 'conversation' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {t('pr.conversation')} ({pr.comments.length})
        </button>
        <button
          onClick={() => setActiveTab('files')}
          className={`rounded-t-md px-3 py-2 text-sm font-medium ${activeTab === 'files' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {t('pr.filesChanged')} ({pr.files.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'conversation' ? (
          <>
            {/* Description / first comment */}
            {pr.body ? (
              <div className="border-b px-4 py-3">
                <div className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
                  <div className="flex items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      {(pr.author ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="text-xs font-medium text-foreground">{pr.author}</span>
                    {pr.updatedAt && <span className="ml-auto text-[11px] text-muted-foreground">{formatDate(pr.updatedAt)}</span>}
                  </div>
                  <div className="px-3 py-2">
                    <Markdown>{pr.body}</Markdown>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Reviewers + Assignees */}
            {(pr.reviewers.length > 0 || pr.assignees.length > 0) && (
              <div className="flex flex-wrap gap-4 border-b px-4 py-3 text-xs">
                {pr.reviewers.length > 0 && (
                  <div>
                    <div className="mb-1 font-semibold uppercase text-muted-foreground">{t('pr.reviewers')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {pr.reviewers.map((r) => (
                        <span
                          key={r.login}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                            r.state === 'APPROVED' ? 'border-green-500/40 bg-green-500/10 text-green-600'
                            : r.state === 'CHANGES_REQUESTED' ? 'border-red-500/40 bg-red-500/10 text-red-500'
                            : r.state === 'COMMENTED' ? 'border-blue-500/40 bg-blue-500/10 text-blue-600'
                            : 'border-border/60 bg-muted/40 text-muted-foreground'
                          }`}
                        >
                          {r.avatar && <img src={r.avatar} alt="" className="h-4 w-4 rounded-full" />}
                          {r.login}{r.state ? ` · ${r.state}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {pr.assignees.length > 0 && (
                  <div>
                    <div className="mb-1 font-semibold uppercase text-muted-foreground">{t('pr.assignees')}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {pr.assignees.map((a) => (
                        <span key={a.login} className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-muted-foreground">
                          {a.avatar && <img src={a.avatar} alt="" className="h-4 w-4 rounded-full" />}
                          {a.login}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Comment threads — each comment collapsed by default */}
            <div className="px-4 py-3">
              {(pr.commentThreads.length === 0) && (
                <div className="text-sm text-muted-foreground">{t('pr.noComments')}</div>
              )}
              {pr.commentThreads.map((thread) => (
                <div key={thread.id} className="mb-3">
                  <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                    <MessageCircle className="h-4 w-4" />
                    {thread.path ? thread.path : t('pr.conversation')}
                    <span className="text-muted-foreground/60">({thread.comments.length})</span>
                  </div>
                  <div className="space-y-2 border-l-2 border-border/40 pl-3">
                    {thread.comments.map((c) => {
                      const isOpen = expandedComments[c.id];
                      return (
                        <div key={c.id} className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
                          <button
                            onClick={() => setExpandedComments((prev) => ({ ...prev, [c.id]: !isOpen }))}
                            className="flex w-full items-center gap-2 border-b border-border/40 bg-muted/30 px-3 py-1.5 text-left hover:bg-muted/50"
                          >
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                              {(c.author ?? '?').slice(0, 1).toUpperCase()}
                            </span>
                            <span className="text-xs font-medium text-foreground">{c.author}</span>
                            {c.createdAt && <span className="ml-auto text-[11px] text-muted-foreground">{formatDate(c.createdAt)}</span>}
                          </button>
                          {isOpen && (
                            <div className="px-3 py-2">
                              <Markdown>{c.body}</Markdown>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* New comment textarea */}
              <div className="mt-2 flex gap-2">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('pr.commentPlaceholder')}
                  rows={3}
                  className="min-w-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button onClick={() => void doComment()} disabled={!comment.trim() || busy !== null} size="sm" className="self-end">
                  {busy === 'comment' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                  {t('pr.post')}
                </Button>
              </div>
            </div>
          </>
        ) : (
          /* Files changed tab */
          <div className="px-4 py-3">
            {pr.files.length === 0 ? (
              <div className="text-sm text-muted-foreground">{t('pr.noFiles')}</div>
            ) : (
              <div className="space-y-1">
                {pr.files.map((f) => {
                  const status = f.status ?? 'modified';
                  const isActive = selectedFile === f.path;
                  return (
                    <button
                      key={f.path}
                      onClick={() => void loadFileDiff(f.path)}
                      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors hover:bg-accent/40 ${
                        isActive ? 'border-primary/60 bg-primary/5' : 'border-border/40'
                      }`}
                    >
                      <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                        status === 'added' ? 'bg-green-500/15 text-green-600'
                        : status === 'removed' ? 'bg-red-500/15 text-red-500'
                        : status === 'renamed' ? 'bg-amber-500/15 text-amber-600'
                        : 'bg-muted text-muted-foreground'
                      }`}>
                        {status === 'added' ? 'NEW' : status === 'removed' ? 'DEL' : status === 'renamed' ? 'REN' : 'MOD'}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">{f.path}</span>
                      {f.additions > 0 && <span className="shrink-0 text-xs text-green-600">+{f.additions}</span>}
                      {f.deletions > 0 && <span className="shrink-0 text-xs text-red-600">−{f.deletions}</span>}
                    </button>
                  );
                })}

                {/* Colorized diff for the selected file — shared modal */}
                <DiffModal file={selectedFile} diff={fileDiff} loading={diffLoading} onClose={() => setSelectedFile(null)} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create review task modal */}
      {reviewOpen && pr && (
        <ReviewTaskModal
          projectId={projectId!}
          prTitle={pr.title}
          prNumber={pr.number}
          prBranch={pr.branch}
          onClose={() => setReviewOpen(false)}
          onCreated={(missionId) => {
            setReviewOpen(false);
            setNote(t('office.createReviewSuccess'));
            navigate(`/mission/${missionId}`);
          }}
        />
      )}

      {/* Confirm destructive PR actions */}
      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction === 'close' ? t('pr.confirmCloseTitle') : t('pr.confirmMergeTitle')}
        message={
          confirmAction === 'close'
            ? t('pr.confirmCloseMsg', { number: pr?.number ?? '' })
            : t('pr.confirmMergeMsg', { number: pr?.number ?? '', method: confirmAction === 'squash' ? t('pr.squash') : t('pr.merge') })
        }
        confirmLabel={confirmAction === 'close' ? t('pr.close') : t('pr.merge')}
        destructive={confirmAction === 'close'}
        onConfirm={() => {
          if (confirmAction === 'close') void doSetState(true);
          else if (confirmAction) void doMerge(confirmAction);
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      >
        {confirmAction !== 'close' && (
          <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-xs text-foreground/90">{t('pr.deleteBranchAfterMerge')}</span>
          </label>
        )}
      </ConfirmDialog>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="icon-anim h-5 w-5 animate-spin" />
    </div>
  );
}

function ReviewTaskModal({
  projectId, prTitle, prNumber, prBranch, onClose, onCreated,
}: {
  projectId: string;
  prTitle: string;
  prNumber: number;
  prBranch: string | null;
  onClose: () => void;
  onCreated: (missionId: string) => void;
}) {
  const { t } = useTranslation();
  const createMission = useStore((s) => s.createMission);
  const missions = useStore((s) => s.missions);
  const [missionName, setMissionName] = useState(t('office.createReviewMission'));
  const [taskName, setTaskName] = useState(`${t('office.createReviewTask')} #${prNumber}`);
  const [description, setDescription] = useState('');
  const [subagentNames, setSubagentNames] = useState<string[]>([]);
  const [recipes, setRecipes] = useState<SubagentRecipe[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.listRecipes().then((r) => setRecipes(r.recipes)).catch(() => {});
  }, []);

  const toggleSubagent = (name: string) => {
    setSubagentNames((prev) => prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]);
  };

  async function submit() {
    if (!missionName.trim() || !taskName.trim() || subagentNames.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      // 1. Reuse an existing "Review PR" mission in this project if one exists,
      //    otherwise create it (via store so it lands in the store).
      const trimmedName = missionName.trim();
      const existing = missions.find((m) => m.project_id === projectId && m.name === trimmedName);
      const mission = existing ?? await createMission({
        projectId,
        name: trimmedName,
        objective: description.trim() || t('office.createReviewHint'),
        gitStrategy: 'none',
        driver: { type: 'hermes', profile: null, model: 'deepseek-v4-flash:cloud', provider: null },
        usesKanban: true,
      });
      // 2. Always create a NEW review task inside it (a PR can have many reviews).
      await api.createTask(mission.id, {
        title: taskName.trim(),
        description: description.trim() || `Review pull request #${prNumber} (${prTitle}).`,
        state: 'todo',
        parentId: null,
        dependsOn: [],
        agent: { type: 'hermes' },
        gitStrategy: 'worktree',
        branch: prBranch, // worktree must check out the PR's head branch, not main
        driver: { profile: null, model: 'deepseek-v4-flash:cloud', provider: null },
        subagentIds: subagentNames,
        reviewPrProjectId: projectId,
        reviewPrNumber: prNumber,
      });
      onCreated(mission.id);
    } catch (e) {
      setError(t('office.createReviewError', { msg: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[6vh] sm:items-center sm:pt-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl sm:max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-bold">{t('office.createReviewTitle')}</h2>
        <p className="mb-3 text-xs text-muted-foreground">{t('office.createReviewHint')}</p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('office.createReviewMissionName')}</label>
            <input
              value={missionName}
              onChange={(e) => setMissionName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('office.createReviewTaskName')}</label>
            <input
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('office.createReviewDescription')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={`Review pull request #${prNumber} (${prTitle}).`}
              className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('office.createReviewSubagents')}</label>
            <div className="flex flex-wrap gap-1.5">
              {[...recipes].sort((a, b) => a.title.localeCompare(b.title)).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleSubagent(r.name)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${subagentNames.includes(r.name) ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent'}`}
                >
                  {r.title}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void submit()}
            disabled={!missionName.trim() || !taskName.trim() || subagentNames.length === 0 || saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {saving ? t('office.createReviewCreating') : t('office.createTask')}
          </button>
        </div>
      </div>
    </div>
  );
}
