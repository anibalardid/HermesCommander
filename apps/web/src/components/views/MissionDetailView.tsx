import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Play, Square, Send, ChevronDown, ChevronRight, Loader2, Columns, List, Brain, Plus, Pencil, Trash2, ArrowLeft, RotateCcw, GitBranch, Folder, PanelRight, GitPullRequest, ExternalLink, AlertTriangle, CheckCircle2, XCircle, Settings, Maximize2, X, RefreshCw, GitCommit, Menu } from '@/components/icons';
import { api } from '@/lib/api';
import { useStore } from '@/store';
import { toast } from '@/lib/toast';
import { Button, Card, Badge } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CreatePrModal } from '@/components/CreatePrModal';
import { CreatePrButton } from '@/components/CreatePrButton';
import { RunStateBadge } from '@/components/RunStateBadge';
import { NotificationBell } from '@/components/NotificationBell';
import { VerdictBadge } from '@/components/VerdictBadge';
import { WorkspacePanel, readSavedWidth, saveWidth } from '@/components/workspace/WorkspacePanel';
import { makeMissionSourceApi } from '@/components/workspace/SourceControlTab';
import { makeMissionFilesApi } from '@/components/workspace/FilesTab';
import type { MissionDetail, Task, AgentRun, AgentLogEntry, SubagentRecipe, SourceStatus } from '@/lib/types';
import { modalSheetCls } from '@/lib/utils';

const COLUMNS = ['todo', 'doing', 'blocked', 'done'] as const;

export function MissionDetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [detail, setDetail] = useState<MissionDetail | null>(null);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState<number>(readSavedWidth);

  // Persist the workspace width on every change.
  useEffect(() => {
    saveWidth(workspaceWidth);
  }, [workspaceWidth]);
  const [interruptMsg, setInterruptMsg] = useState('');
  const [sendingInterrupt, setSendingInterrupt] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [prState, setPrState] = useState<'OPEN' | 'CLOSED' | 'MERGED' | 'DRAFT' | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [recheckNote, setRecheckNote] = useState<string | null>(null);
  const [taskCommitMsg, setTaskCommitMsg] = useState('');
  const [taskCommitBusy, setTaskCommitBusy] = useState(false);
  const [taskCommitNote, setTaskCommitNote] = useState<string | null>(null);
  // Source status of the selected task's worktree — used to decide whether the
  // commit/push box should show (only when there are real uncommitted changes).
  const [taskSource, setTaskSource] = useState<SourceStatus | null>(null);
  // Fix-task branch choice modal: when the user clicks "Create Fix Task" on a
  // review task, ask whether to work on the SAME PR branch or a NEW branch
  // derived from it. null = modal closed.
  const [fixTarget, setFixTarget] = useState<Task | null>(null);
  const mission = useStore((s) => s.missions.find((m) => m.id === id));
  const project = useStore((s) => s.projects.find((p) => p.id === mission?.project_id));
  // Detect mobile PORTRAIT (phone held vertically) so the task view is always
  // List there and the kanban/list toggle is hidden. In landscape, tablet, or
  // desktop the default is Kanban and the toggle is shown.
  const [isMobilePortrait, setIsMobilePortrait] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 767px) and (orientation: portrait)').matches;
  });
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 767px) and (orientation: portrait)');
    const onChange = (e: MediaQueryListEvent) => setIsMobilePortrait(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  // Persist the board/list view per project so it survives reloads/navigation.
  // On mobile portrait the default is List; elsewhere it's Kanban.
  const [view, setView] = useState<'kanban' | 'list'>(() => {
    const projectId = mission?.project_id;
    if (!projectId) return 'kanban';
    const saved = localStorage.getItem(`hermes-commander.view.${projectId}`);
    if (saved === 'list' || saved === 'kanban') return saved;
    return isMobilePortrait ? 'list' : 'kanban';
  });
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [taskEvents, setTaskEvents] = useState<Array<{ type: string; payload: Record<string, unknown>; created_at: number }>>([]);
  const [taskRuns, setTaskRuns] = useState<AgentRun[]>([]);
  const [taskLogs, setTaskLogs] = useState<AgentLogEntry[]>([]);
  const { deleteMission, deleteTask } = useStore();
  const mobileNavOpen = useStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useStore((s) => s.setMobileNavOpen);
  const liveTasks = useStore((s) => s.liveTasks);
  const [confirmDeleteMission, setConfirmDeleteMission] = useState(false);
  const [confirmDeleteTask, setConfirmDeleteTask] = useState<Task | null>(null);
  const [deleteStep, setDeleteStep] = useState<'worktree' | 'confirm' | null>(null);
  const [outputModalOpen, setOutputModalOpen] = useState(false);
  const [planningIds, setPlanningIds] = useState<Set<string>>(new Set());
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [editMissionOpen, setEditMissionOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editObjective, setEditObjective] = useState('');
  const [editTaskDesc, setEditTaskDesc] = useState<string | null>(null);
  const [specOpen, setSpecOpen] = useState(false);
  const [subtaskSpecOpen, setSubtaskSpecOpen] = useState(false);
  const [depSaved, setDepSaved] = useState(false);
  const [depError, setDepError] = useState<string | null>(null);
  const [pendingDep, setPendingDep] = useState<{ depId: string; next: string[]; adding: boolean; title: string } | null>(null);
  const [allRecipes, setAllRecipes] = useState<SubagentRecipe[]>([]);
  const [postingComment, setPostingComment] = useState(false);
  const [commentNote, setCommentNote] = useState<string | null>(null);
  // Task whose Create-PR modal is currently open.
  const [prModalTask, setPrModalTask] = useState<Task | null>(null);

  // Load available subagent recipes (for showing/editing a task's subagents).
  useEffect(() => {
    void api.listRecipes().then((r) => setAllRecipes(r.recipes));
  }, []);

  // Load the selected task's history (events) + runs + logs.
  useEffect(() => {
    if (!id || !selectedTask) { setTaskEvents([]); setTaskRuns([]); setTaskLogs([]); return; }
    void api.listMissionEvents(id, selectedTask.id).then((r) => setTaskEvents(r.events));
    void api.listRunsForTask(selectedTask.id).then(async ({ runs }) => {
      setTaskRuns(runs);
      if (runs.length > 0) {
        const last = runs[runs.length - 1];
        const { logs } = await api.listLogsForRun(last.id);
        setTaskLogs(logs);
      } else {
        // An orchestrator (parent) task has no runs of its own — it only plans
        // and delegates. Surface the output of its subtasks (especially the
        // final gate, which holds the verdict) so the parent shows the result.
        const children = detail?.tasks.filter((t: Task) => t.parent_id === selectedTask.id) ?? [];
        if (children.length > 0) {
          const allLogs: AgentLogEntry[] = [];
          for (const child of children) {
            const { runs: childRuns } = await api.listRunsForTask(child.id);
            for (const run of childRuns) {
              const { logs } = await api.listLogsForRun(run.id);
              allLogs.push(...logs);
            }
          }
          setTaskLogs(allLogs);
        } else {
          setTaskLogs([]);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, selectedTask?.id]);

  // Switch the view AND persist it per project.
  function setViewPersisted(v: 'kanban' | 'list') {
    setView(v);
    if (mission?.project_id) {
      localStorage.setItem(`hermes-commander.view.${mission.project_id}`, v);
    }
  }

  // When the mission's project is known (or changes), sync the persisted view.
  useEffect(() => {
    if (!mission?.project_id) return;
    const saved = localStorage.getItem(`hermes-commander.view.${mission.project_id}`);
    if (saved === 'list' || saved === 'kanban') setView(saved);
  }, [mission?.project_id]);

  useEffect(() => {
    if (!id) return;
    void api.getMission(id).then((d) => setDetail(d));
    void api.listMissionLogs(id).then(({ logs }) => setLogs(logs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live kanban sync: subscribe to this mission's channel and refresh the
  // detail whenever a task/mission event arrives over the WebSocket.
  useEffect(() => {
    if (!id) return;
    const { subscribeMission, unsubscribeMission, onMissionEvent } = useStore.getState();
    subscribeMission(id);
    const off = onMissionEvent(id, () => {
      void api.getMission(id).then((d) => {
        setDetail(d);
        // Re-sync the open task modal with the freshest copy of the task so its
        // actions (Retry ↦ Running, etc.) reflect the live state immediately.
        setSelectedTask((cur) => (cur ? (d.tasks.find((x: Task) => x.id === cur.id) ?? cur) : cur));
      });
    });
    return () => {
      off();
      unsubscribeMission(id);
    };
  }, [id]);

  // When a task with a linked PR is opened, fetch the PR's live state so the
  // action buttons reflect reality (e.g. show "Open PR" instead of "Add
  // comment" once the PR is merged).
  useEffect(() => {
    setPrState(null);
    if (!selectedTask?.review_pr_project_id || !selectedTask.review_pr_number) return;
    void api.getPrDetail(selectedTask.review_pr_project_id, selectedTask.review_pr_number)
      .then((d) => setPrState(d.pr?.state ?? null))
      .catch(() => setPrState(null));
  }, [selectedTask?.id, selectedTask?.review_pr_project_id, selectedTask?.review_pr_number]);

  // Load the selected task's source status so the commit/push box only shows
  // when there are real uncommitted changes (not on done/running tasks that
  // already pushed or have nothing to commit).
  useEffect(() => {
    setTaskSource(null);
    setTaskCommitNote(null);
    if (!selectedTask?.worktree_path) return;
    void api.getTaskSource(selectedTask.id)
      .then((s) => setTaskSource(s))
      .catch(() => setTaskSource(null));
  }, [selectedTask?.id, selectedTask?.worktree_path]);

  async function loadLogs(runs: AgentRun[]) {
    if (runs.length === 0) return;
    const last = runs[runs.length - 1];
    const { logs } = await api.listLogsForRun(last.id);
    setLogs(logs);
  }

  async function sendInterrupt() {
    if (!id || !interruptMsg.trim() || sendingInterrupt) return;
    setSendingInterrupt(true);
    try {
      await api.interruptMission(id, interruptMsg.trim());
      setInterruptMsg('');
    } finally {
      setSendingInterrupt(false);
    }
  }

  // Applies a confirmed depends-on change for the selected task.
  async function applyDep() {
    if (!pendingDep) return;
    const { next } = pendingDep;
    setPendingDep(null);
    try {
      const updated = await api.updateTask(selectedTask!.id, { dependsOn: next });
      setSelectedTask(updated);
      if (id) void api.getMission(id).then((d) => setDetail(d));
      setDepSaved(true);
      window.setTimeout(() => setDepSaved(false), 2500);
    } catch (e) {
      console.error('update deps failed', e);
      setDepError(t('task.depCycleError'));
    }
  }

  // Runs a single task as its own subagent (orchestrator is always Hermes).
  // The backend spawns a `hermes` process scoped to this task; the board
  // updates live over the WebSocket when it completes.
  async function runTask(task: Task) {
    if (task.state === 'doing' || startingId) return;
    setStartingId(task.id);
    try {
      await api.runTask(task.id);
      if (id) void api.getMission(id).then((d) => setDetail(d));
    } catch (e) {
      console.error('runTask failed', e);
    } finally {
      setStartingId(null);
    }
  }

  async function stopTask(task: Task) {
    if (stoppingId) return;
    setStoppingId(task.id);
    try {
      await api.stopTask(task.id);
      if (id) void api.getMission(id).then((d) => setDetail(d));
    } catch (e) {
      console.error('stopTask failed', e);
    } finally {
      setStoppingId(null);
    }
  }

  /** Create a follow-up "fix" task for a PR review that needs changes. It
      reuses the review's worktree (so the fix works on the same PR branch)
      and preloads the review's description as the fix objective. */
  async function createFixTask(reviewTask: Task, mode: 'same' | 'new') {
    if (fixingId || !id) return;
    setFixingId(reviewTask.id);
    try {
      // For a fix on a NEW branch, derive a branch name from the PR number and
      // record the PR head branch as base_branch so the worktree is created
      // FROM it (not from main). For a fix on the SAME branch, reuse the review
      // task's branch/worktree as before.
      const prNum = reviewTask.review_pr_number ?? '';
      const newBranch = mode === 'new' ? `fix/pr-${prNum}` : reviewTask.branch;
      const created = await api.createTask(id, {
        title: t('task.fixTaskTitle', { pr: prNum }),
        description: t('task.fixTaskDescription', { pr: prNum, review: reviewTask.description ?? '' }),
        state: 'todo',
        parentId: null,
        dependsOn: [],
        agent: { type: 'hermes' },
        gitStrategy: 'worktree',
        branch: newBranch,
        baseBranch: mode === 'new' ? reviewTask.branch : null,
        worktreePath: mode === 'same' ? reviewTask.worktree_path : null,
        driver: { profile: reviewTask.driver_profile, model: reviewTask.driver_model, provider: reviewTask.driver_provider },
        subagentIds: [],
        reviewPrProjectId: reviewTask.review_pr_project_id,
        reviewPrNumber: reviewTask.review_pr_number,
      });
      if (id) void api.getMission(id).then((d) => setDetail(d));
      // Open the new fix task in the modal.
      setSelectedTask(created);
    } catch (e) {
      console.error('createFixTask failed', e);
    } finally {
      setFixingId(null);
    }
  }

  async function planTask(task: Task) {
    if (planningIds.has(task.id)) return; // already planning this task
    setPlanningIds((prev) => new Set(prev).add(task.id));
    try {
      await api.planTask(task.id);
      if (id) void api.getMission(id).then((d) => setDetail(d));
    } catch (e) {
      console.error('planTask failed', e);
    } finally {
      setPlanningIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }

  /** Re-check stale task/mission state: flags tasks left in an active state
   *  with no live process (e.g. after a server restart) and auto-retries
   *  them. Refreshes the board after. */
  async function recheckStatus() {
    if (rechecking) return;
    setRechecking(true);
    setRecheckNote(null);
    try {
      const r = await api.runWatchdog();
      setRecheckNote(
        r.tasksRecovered > 0 || r.missionsRecovered > 0
          ? t('mission.recheckRecovered', { tasks: r.tasksRecovered, missions: r.missionsRecovered })
          : t('mission.recheckOk')
      );
      if (id) void api.getMission(id).then((d) => setDetail(d));
    } catch (e) {
      setRecheckNote(t('mission.recheckError'));
      console.error('recheckStatus failed', e);
    } finally {
      setRechecking(false);
    }
  }

  /** Post this task's output (the review verdict) as a comment on the linked PR. */
  async function postCommentToPr() {
    if (!selectedTask || !selectedTask.review_pr_project_id || !selectedTask.review_pr_number || postingComment) return;
    setPostingComment(true);
    setCommentNote(null);
    try {
      // Build the comment body from the task's output (final verdict) if present.
      const outputText = taskLogs.map((l) => l.message).join('\n').trim();
      const body = outputText
        ? `**${selectedTask.title}**\n\n${outputText}`
        : `${selectedTask.title}\n\n(No output recorded.)`;
      await api.addPrComment(selectedTask.review_pr_project_id, selectedTask.review_pr_number, body);
      setCommentNote(t('office.commentPosted', { number: selectedTask.review_pr_number }));
    } catch (e) {
      setCommentNote(t('office.commentPostError', { msg: (e as Error).message }));
    } finally {
      setPostingComment(false);
    }
  }

  /** Commit the selected task's uncommitted changes in its worktree/branch,
   *  then push. Only shown when the task has a worktree/branch with changes. */
  async function commitAndPushTask() {
    if (!selectedTask || taskCommitBusy) return;
    setTaskCommitBusy(true);
    setTaskCommitNote(null);
    try {
      const msg = taskCommitMsg.trim() || `feat(${selectedTask.title.toLowerCase().replace(/\s+/g, '-')}): work in progress`;
      await api.taskCommit(selectedTask.id, msg);
      await api.taskPush(selectedTask.id);
      setTaskCommitMsg('');
      setTaskCommitNote(t('task.commitPushed'));
      // Refresh the mission detail so the task's source state updates.
      if (id) void api.getMission(id).then((d) => setDetail(d));
    } catch (e) {
      setTaskCommitNote(t('task.commitPushError', { msg: (e as Error).message }));
    } finally {
      setTaskCommitBusy(false);
    }
  }

  /** A completed (non-review) task is eligible for a source action. The button
   *  itself decides what to offer: Create PR (own branch + changes), Commit & Push
   *  (no own branch, inherits project branch), or a "no changes" notice. */
  const canCreatePr = (t: Task) =>
    t.state === 'done' &&
    !t.review_pr_project_id;

  if (!mission || !detail) return <div className="p-6 text-muted-foreground">{t('common.loading')}</div>;

  const tasks = detail.tasks;
  // A task is an "orchestrator" (parent) if it has no parent of its own.
  const hasChildren = (t: Task) => tasks.some((x: Task) => x.parent_id === t.id);
  const isOrchestrator = (t: Task) => !t.parent_id;
  // An orchestrator with no subtasks yet must be planned first (no play).
  const needsPlan = (t: Task) => isOrchestrator(t) && !hasChildren(t);
  // Sub-states that mean the task is actively executing (show Stop, not Run).
  const isRunning = (t: Task) =>
    ['planning', 'delegating', 'running', 'waiting', 'waiting_review', 'waiting_user'].includes(t.run_state);
  // The run_state to DISPLAY. A task whose state is 'blocked' (a subtask
  // failed, or the orchestrator was marked failed) must show "failed", never a
  // stale "delegating"/"running" that lingers when the run was interrupted
  // (e.g. server restart) before the close event fired.
  const displayRunState = (t: Task): string =>
    t.state === 'blocked' ? 'failed' : t.run_state;

  // Whether to render a run-state badge for a task. Positive whitelist: show it
  // only for "active/live" run states (planning, delegating, running, waiting,
  // waiting_review, waiting_user, paused, failed). Idle and done never show a
  // badge. Anything unexpected falls through to "don't show".
  const activeRunStatesShown = ['planning', 'delegating', 'running', 'waiting', 'waiting_review', 'waiting_user', 'paused', 'failed'];
  const showRunStateBadge = (t: Task): boolean =>
    !!t.run_state && activeRunStatesShown.includes(t.run_state);
  // The effective review verdict: use the structured field when set, otherwise
  // fall back to scanning the task's logs (an orchestrator's logs include its
  // subtasks' output — the final review gate ends with `VERDICT: ...`). This
  // keeps the "create fix task" button working even when the structured
  // verdict failed to persist (e.g. a re-run after a server crash).
  const effectiveVerdict = (t: Task): 'pass' | 'needs_changes' | 'reject' | null => {
    if (t.review_verdict) return t.review_verdict;
    if (!t.review_pr_project_id || !t.review_pr_number) return null;
    const text = taskLogs.map((l) => l.message).join('\n');
    // Take the LAST verdict line. Each subagent log embeds its instruction
    // prompt, which lists all three options (VERDICT: PASS / NEEDS CHANGES /
    // REJECT), so the first match is always the prompt's PASS. The real verdict
    // is the final gate's, which runs last — so the last match wins.
    const matches = [...text.matchAll(/VERDICT:\s*(PASS|NEEDS CHANGES|REJECT)/gi)];
    if (matches.length === 0) return null;
    const v = matches[matches.length - 1][1].toUpperCase();
    return v === 'PASS' ? 'pass' : v === 'NEEDS CHANGES' ? 'needs_changes' : 'reject';
  };
  const driver = detail.mission.driver_type;
  // The effective provider/model for a task: its own override, else the driver's.
  const modelFor = (t: Task) => t.agent_llm ?? detail.mission.driver_model;
  const providerFor = (t: Task) => t.agent_provider ?? detail.mission.driver_provider;
  // While a task is generating its plan/subtasks, lock the whole task panel.
  const isPlanning = planningIds.has(selectedTask?.id ?? '');
  const agentLabel = (t: Task) => {
    const m = modelFor(t);
    const p = providerFor(t);
    return p ? `${p} · ${m}` : m;
  };
  // Map a recipe name (agent_type) to its human title, e.g. 'frontend' → 'Frontend'.
  const recipeTitle = (name: string | null) => {
    if (!name) return null;
    const r = allRecipes.find((x) => x.name === name);
    return r ? r.title : name;
  };
  // Accent color per column state for the kanban left edge.
  const stateColor = (s: string) =>
    s === 'done' ? 'border-l-green-500'
      : s === 'doing' ? 'border-l-blue-500'
      : s === 'blocked' ? 'border-l-red-500'
      : 'border-l-muted-foreground/40';

  // Hierarchical order: each task's children appear immediately after it, so
  // the list reads parent → child → child, parent → child → child (not all
  // parents first, then all children). Stable within a level by sort_order.
  //
  // A task is treated as a root when it has no parent at all, OR when its
  // parent isn't present in the current list. The latter happens when a column
  // contains subtasks whose parent lives in a different column (e.g. the
  // orchestrator is in 'doing' while some of its subtasks are in 'todo'); if we
  // only started from parent_id === null, those subtasks would silently vanish.
  const hierarchicalOrder = (list: Task[]): Task[] => {
    const inList = new Set(list.map((x) => x.id));
    const childrenOf = (id: string | null) =>
      list.filter((x) => x.parent_id === id).sort((a, b) => a.sort_order - b.sort_order);
    const roots = list.filter((x) => !x.parent_id || !inList.has(x.parent_id));
    const out: Task[] = [];
    const visit = (id: string | null) => {
      for (const t of childrenOf(id)) {
        out.push(t);
        visit(t.id);
      }
    };
    for (const r of roots.sort((a, b) => a.sort_order - b.sort_order)) {
      out.push(r);
      visit(r.id);
    }
    return out;
  };

  // --- Kanban grouping by family (orchestrator + all descendants) -----------
  // The whole family moves as ONE unit through the board: a parent and its
  // subtasks never scatter across different columns. The family's column is
  // derived from its overall progress; each member shows its own run-state
  // legend so you can still tell what each subtask is doing.
  //
  // A "root" is any task with no parent (or whose parent is not in the list).
  // Families are keyed by their root id; a root with no children is still its
  // own family.
  type Family = { root: Task; members: Task[] };

  const buildFamilies = (): Family[] => {
    const roots = tasks.filter((t) => !t.parent_id);
    // Roots in sort order; any subtask whose parent root is missing is its own.
    const rootsInOrder = hierarchicalOrder(tasks).filter((t) => !t.parent_id);
    const rootIds = new Set(roots.map((r) => r.id));
    const orphanSubtasks = tasks.filter((t) => t.parent_id && !rootIds.has(t.parent_id));
    const families: Family[] = rootsInOrder.map((root) => ({
      root,
      members: tasks.filter((t) => t.parent_id === root.id).sort((a, b) => a.sort_order - b.sort_order),
    }));
    for (const o of orphanSubtasks) families.push({ root: o, members: [] });
    return families;
  };

  // Column for a family, derived from aggregate progress:
  //   blocked if the root or any member is blocked/failed;
  //   doing   if the root is doing/delegating or any member is doing/running;
  //   done    only if every member is done (and the root is done);
  //   todo    otherwise.
  const familyState = (f: Family): Task['state'] => {
    const all = [f.root, ...f.members];
    if (all.some((x) => x.state === 'blocked')) return 'blocked';
    if (f.root.state === 'doing') return 'doing';
    if (f.members.some((x) => x.state === 'doing')) return 'doing';
    if (f.root.state === 'done' && f.members.length > 0 && f.members.every((x) => x.state === 'done')) {
      return 'done';
    }
    if (f.members.length === 0 && f.root.state === 'done') return 'done';
    return 'todo';
  };

  // Human legend for a member of a family — how it's currently doing.
  function subtaskLegend(tk: Task): string | null {
    if (tk.state === 'done') return t('task.legend.done');
    if (tk.state === 'blocked') return t('task.legend.blocked');
    if (tk.state === 'doing') return t('task.legend.running');
    if (tk.run_state === 'delegating') return t('task.legend.delegating');
    return t('task.legend.waiting');
  }

  // Human-readable description of a history event (never raw JSON). Handles the
  // { before, after } payload shape used by task PATCHes (state + run_state),
  // and returns null for no-op transitions so the caller can hide them.
  function describeEvent(ev: { type: string; payload: Record<string, unknown> }): string | null {
    const p = ev.payload;
    const val = (k: string) => (typeof p[k] === 'string' ? String(p[k]) : p[k] as number | boolean | null | undefined);
    switch (ev.type) {
      case 'task_created': return t('history.taskCreated');
      case 'state_change':
        return t('history.stateChanged', { from: val('from') ?? '—', to: val('to') ?? val('state') ?? '—' });
      case 'task_status': {
        // Orchestrator completion / failure payloads carry top-level fields.
        if (val('report')) return t('history.report');
        if (val('reason')) return t('history.taskFailed', { state: val('state') ?? '—', reason: val('reason') });
        if (val('ok') === true) return t('history.taskCompleted');

        // Transition payload from PATCH: { before: {state, run_state}, after: {...} }.
        const before = (p as { before?: Record<string, unknown> }).before;
        const after = (p as { after?: Record<string, unknown> }).after;
        if (!before || !after) return null;
        const bState = String(before.state ?? '');
        const aState = String(after.state ?? '');
        const bRun = String(before.run_state ?? '');
        const aRun = String(after.run_state ?? '');
        const stateChanged = bState !== aState;
        const runChanged = bRun !== aRun;
        // Skip pure no-op saves (nothing visibly changed).
        if (!stateChanged && !runChanged) return null;
        // Prefer reporting a run-state transition (more informative for a running board).
        if (runChanged) return t('history.runStateChanged', { from: stateName(bRun), to: stateName(aRun) });
        return t('history.stateChanged', { from: stateName(bState), to: stateName(aState) });
      }
      case 'task_assigned':
        return t('history.taskAssigned', { agent: val('agent') ?? val('agent_type') ?? '—' });
      case 'error':
        return t('history.error', { msg: val('error') ?? val('message') ?? '—' });
      default:
        // Last-resort human fallback: a few key fields, not a JSON dump.
        const known = ['state', 'to', 'from', 'agent', 'agent_type', 'error', 'message', 'reason', 'ok', 'code', 'report'];
        const parts = known.filter((k) => p[k] !== undefined && p[k] !== null)
          .map((k) => `${k}: ${String(p[k])}`);
        return parts.length ? parts.join(' · ') : ev.type;
    }
  }

  // Map a state/run_state token to a human label via i18n (with a sane fallback).
  function stateName(s: string): string {
    if (!s) return '—';
    const key = `task.${s}`;
    // Only return the translated token if it resolves to something; otherwise keep raw.
    const resolved = t(key);
    return resolved === key ? s : resolved;
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        {/* Hamburger menu — mobile only, opens the nav drawer (first) */}
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          aria-label={t('nav.openMenu')}
          aria-expanded={mobileNavOpen}
          aria-controls="mobile-nav-drawer"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
        >
          <Menu className="icon-anim h-5 w-5" />
        </button>
        <button onClick={() => navigate(`/project/${mission.project_id}`)} className="rounded-md p-1 hover:bg-accent" aria-label={t('common.back')}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold leading-tight">{mission.name}</h1>
              {/* Action icons — inline with the title */}
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  onClick={() => void recheckStatus()}
                  title={t('mission.recheck')}
                  aria-label={t('mission.recheck')}
                  disabled={rechecking}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${rechecking ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => { setEditName(mission.name); setEditObjective(mission.objective); setEditMissionOpen(true); }}
                  title={t('common.edit')}
                  aria-label={t('common.edit')}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setConfirmDeleteMission(true)}
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {mission.objective ? (
              <p className="line-clamp-1 text-xs text-muted-foreground">{mission.objective}</p>
            ) : null}
            <p className="truncate text-xs text-muted-foreground">
              {t('mission.driver')}: {driver} · {mission.driver_model}
              {detail.mission.branch ? ` · ${t('project.branch')}: ${detail.mission.branch}` : ''}
            </p>
            {recheckNote && (
              <p className={`truncate text-[11px] ${recheckNote.startsWith(t('mission.recheckError')) ? 'text-red-500' : 'text-green-600'}`}>
                {recheckNote}
              </p>
            )}
          </div>
        </div>
        {/* View toggle + workspace — right-aligned, same on all breakpoints */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* View toggle: board vs list — hidden on mobile (moved below header) */}
          <div className="mr-0.5 hidden items-center rounded-lg border border-border bg-muted/40 p-0.5 md:flex">
            <button
              onClick={() => setViewPersisted('kanban')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title={t('mission.viewKanban')}
            >
              <Columns className="h-3.5 w-3.5" /> {t('mission.viewKanban')}
            </button>
            <button
              onClick={() => setViewPersisted('list')}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              title={t('mission.viewList')}
            >
              <List className="h-3.5 w-3.5" /> {t('mission.viewList')}
            </button>
          </div>
          <Button
            onClick={() => setWorkspaceOpen((v) => !v)}
            size="sm" variant={workspaceOpen ? 'default' : 'outline'}
            className="active:scale-95"
            aria-label={t('workspace.title')}
            title={t('workspace.title')}
          >
            <PanelRight className="icon-anim h-4 w-4" />
          </Button>
          <NotificationBell />
        </div>
      </header>

      {/* Mobile-only view toggle row (below header) — hidden in portrait (always List) */}
      {!isMobilePortrait && (
      <div className="flex items-center gap-1.5 border-b px-4 py-2 md:hidden">
        <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
          <button
            onClick={() => setViewPersisted('kanban')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            title={t('mission.viewKanban')}
          >
            <Columns className="h-3.5 w-3.5" /> {t('mission.viewKanban')}
          </button>
          <button
            onClick={() => setViewPersisted('list')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            title={t('mission.viewList')}
          >
            <List className="h-3.5 w-3.5" /> {t('mission.viewList')}
          </button>
        </div>
      </div>
      )}

      <div className="relative flex flex-1 overflow-hidden">
        {/* Kanban or List — always occupies the remaining space.
            In mobile portrait the view is forced to List (kanban is cramped). */}
        <div className="min-w-0 flex-1 overflow-hidden p-6">
        {(!isMobilePortrait && view === 'kanban') ? (
          <div className="h-full overflow-auto pb-24">
            <div className="grid min-w-[600px] grid-cols-4 gap-3">
              {COLUMNS.map((col) => {
                const families = buildFamilies().filter((f) => familyState(f) === col);
                return (
                <div key={col} className="flex flex-col rounded-lg bg-muted/40 p-2">
                  <div className="mb-2 px-1 text-xs font-semibold uppercase text-muted-foreground">
                    {t(`task.${col}`)}
                    <span className="ml-1 text-muted-foreground/50">
                      {families.length}
                    </span>
                  </div>
                  {/* New task button — at the top of the TODO column, above all tasks */}
                  {col === 'todo' && (
                    <button
                      onClick={() => setNewTaskOpen(true)}
                      className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <Plus className="h-3.5 w-3.5" /> {t('task.add')}
                    </button>
                  )}
                  <div className="flex-1 space-y-3">
                    {families.map((f) => (
                      <div key={f.root.id} className="rounded-lg border border-border/50 bg-background/40">
                        {/* Parent card */}
                        <div
                          onClick={() => setSelectedTask(f.root)}
                          className="w-full cursor-pointer text-left"
                        >
                          <Card className={`m-1 p-3 text-sm transition-colors hover:border-primary/50 border-l-4 ${stateColor(f.root.state)}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1 truncate font-medium">{f.root.title}</div>
                              {f.root.review_verdict && (
                                <VerdictBadge verdict={f.root.review_verdict} className="shrink-0" />
                              )}
                              {f.root.state === 'done' ? (
                                canCreatePr(f.root) ? (
                                  <CreatePrButton task={f.root} onOpen={setPrModalTask} />
                                ) : null
                              ) : f.root.state === 'doing' ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); void stopTask(f.root); }}
                                  title={t('task.stop')}
                                  aria-label={t('task.stop')}
                                  disabled={stoppingId === f.root.id}
                                  className="shrink-0 rounded-md bg-destructive p-1.5 text-destructive-foreground shadow transition-all hover:bg-red-600 hover:shadow-md active:scale-90 disabled:opacity-60"
                                >
                                  {stoppingId === f.root.id ? (
                                    <Loader2 className="icon-anim h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Square className="icon-anim h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : f.members.length === 0 && needsPlan(f.root) ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); void planTask(f.root); }}
                                  title={t('task.plan')}
                                  aria-label={t('task.plan')}
                                  disabled={planningIds.has(f.root.id)}
                                  className="shrink-0 rounded-md bg-primary/80 p-1.5 text-primary-foreground shadow transition-all hover:bg-primary hover:shadow-md active:scale-90 disabled:opacity-60"
                                >
                                  {planningIds.has(f.root.id) ? (
                                    <Loader2 className="icon-anim h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Brain className="icon-anim h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); void runTask(f.root); }}
                                  title={t('task.run')}
                                  aria-label={t('task.run')}
                                  disabled={startingId === f.root.id}
                                  className="shrink-0 rounded-md bg-primary p-1.5 text-primary-foreground shadow transition-all hover:bg-green-600 hover:shadow-md active:scale-90 disabled:opacity-60"
                                >
                                  {startingId === f.root.id ? (
                                    <Loader2 className="icon-anim h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Play className="icon-anim h-3.5 w-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                            {f.root.agent_type && (
                              <Badge variant="outline" className="mt-1">{agentLabel(f.root)}</Badge>
                            )}
                            {showRunStateBadge(f.root) && (
                              <div className="mt-1"><RunStateBadge state={displayRunState(f.root)} alive={liveTasks[f.root.id]} /></div>
                            )}
                            {f.root.description && (
                              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground/80">{f.root.description}</p>
                            )}
                          </Card>
                        </div>

                        {/* Subtask members — always shown with the family */}
                        {f.members.length > 0 && (
                          <div className="space-y-1 px-1 pb-1">
                            {f.members.map((m) => (
                              <div
                                key={m.id}
                                onClick={() => setSelectedTask(m)}
                                className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-muted-foreground/30 px-2 py-1.5 text-xs transition-colors hover:border-primary/50"
                              >
                                <div className="min-w-0 flex-1 truncate text-muted-foreground">{m.title}</div>
                                <span
                                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                    m.state === 'done'
                                      ? 'bg-green-500/15 text-green-600'
                                      : m.state === 'blocked'
                                        ? 'bg-red-500/15 text-red-600'
                                        : m.state === 'doing'
                                          ? 'bg-blue-500/15 text-blue-600'
                                          : 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {subtaskLegend(m)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* List view — grouped by column (state sections, no horizontal scroll) */
          <div className="overflow-y-auto pb-24">
            <div className="space-y-5">
              {tasks.length === 0 && (
                <div className="p-8 text-center text-sm text-muted-foreground">{t('common.empty')}</div>
              )}
              {COLUMNS.map((col) => {
                const colFamilies = buildFamilies().filter((f) => familyState(f) === col);
                return (
                  <div key={col}>
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <span className={`h-2.5 w-2.5 rounded-full ${
                        col === 'done' ? 'bg-green-500' :
                        col === 'doing' ? 'bg-blue-500' :
                        col === 'blocked' ? 'bg-red-500' : 'bg-muted-foreground/50'
                      }`} />
                      <span className="text-xs font-semibold uppercase text-muted-foreground">{t(`task.${col}`)}</span>
                      <span className="text-xs text-muted-foreground/60">({colFamilies.length})</span>
                    </div>
                    {/* New task button — at the top of the TODO section, above all tasks */}
                    {col === 'todo' && (
                      <button
                        onClick={() => setNewTaskOpen(true)}
                        className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                      >
                        <Plus className="h-3.5 w-3.5" /> {t('task.add')}
                      </button>
                    )}
                    <div className="space-y-1.5">
                      {colFamilies.length === 0 && (
                        <div className="rounded-lg border border-dashed border-border/60 p-3 text-xs text-muted-foreground/60">
                          {t('task.noTasksInColumn')}
                        </div>
                      )}
                      {colFamilies.map((f) => (
                        <div key={f.root.id} className="rounded-lg border border-border/60 bg-card">
                          {/* Parent card — left border colored by state */}
                          <button
                            onClick={() => setSelectedTask(f.root)}
                            className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg border-l-4 p-3 text-left text-sm transition-colors hover:bg-accent/40 ${stateColor(f.root.state)}`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{f.root.title}</div>
                              {f.root.agent_type && (
                                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{agentLabel(f.root)}</div>
                              )}
                              {showRunStateBadge(f.root) && (
                                <div className="mt-1.5"><RunStateBadge state={displayRunState(f.root)} alive={liveTasks[f.root.id]} /></div>
                              )}
                              {f.root.description && (
                                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground/80">{f.root.description}</p>
                              )}
                            </div>
                            {canCreatePr(f.root) && (
                              <CreatePrButton task={f.root} onOpen={setPrModalTask} />
                            )}
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                          </button>
                          {/* Subtask members — subcards below the parent */}
                          {f.members.length > 0 && (
                            <div className="space-y-1 border-t border-border/40 px-2 py-1.5">
                              {f.members.map((m) => (
                                <button
                                  key={m.id}
                                  onClick={() => setSelectedTask(m)}
                                  className={`group flex w-full cursor-pointer items-center gap-2 rounded-md border-l-4 bg-muted/30 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/40 ${stateColor(m.state)}`}
                                >
                                  <div className="min-w-0 flex-1 truncate text-muted-foreground">{m.title}</div>
                                  <span
                                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                      m.state === 'done'
                                        ? 'bg-green-500/15 text-green-600'
                                        : m.state === 'blocked'
                                          ? 'bg-red-500/15 text-red-600'
                                          : m.state === 'doing'
                                            ? 'bg-blue-500/15 text-blue-600'
                                            : 'bg-muted text-muted-foreground'
                                    }`}
                                  >
                                    {subtaskLegend(m)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Interrupt / redirect the agent — moved inside the workspace area */}
        {(mission.state === 'running' || mission.state === 'paused') && (
          <div className="mb-3 flex gap-2">
            <input
              value={interruptMsg}
              onChange={(e) => setInterruptMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void sendInterrupt()}
              placeholder={t('mission.interruptPlaceholder')}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button onClick={() => void sendInterrupt()} size="icon" disabled={!interruptMsg.trim() || sendingInterrupt}>
              {sendingInterrupt ? <Loader2 className="icon-anim h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        )}
        </div>

        {/* Workspace panel (Logs / Source control / Files) — resizable */}
        <WorkspacePanel
          open={workspaceOpen}
          onClose={() => setWorkspaceOpen(false)}
          scope="mission"
          logs={logs}
          sourceApi={makeMissionSourceApi(mission.id, project?.id ?? '')}
          filesApi={makeMissionFilesApi(mission.id)}
          width={workspaceWidth}
          onWidthChange={setWorkspaceWidth}
          cwd={project?.path ?? undefined}
          tasks={detail?.tasks ?? []}
        />
      </div>

      {/* Task detail bottom sheet */}
      <BottomSheet open={!!selectedTask} onClose={() => setSelectedTask(null)} title={t('task.detail')}>
        {selectedTask && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {/* Back button: subtask → its parent; parent → close. */}
                {selectedTask.parent_id ? (
                  <button
                    onClick={() => {
                      const parent = tasks.find((x: Task) => x.id === selectedTask.parent_id);
                      if (parent) setSelectedTask(parent);
                    }}
                    disabled={isPlanning}
                    title={t('task.back')}
                    aria-label={t('task.back')}
                    className="shrink-0 rounded-md border border-border/60 p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => setSelectedTask(null)}
                    disabled={isPlanning}
                    title={t('task.back')}
                    aria-label={t('task.back')}
                    className="shrink-0 rounded-md border border-border/60 p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <div className="text-lg font-semibold">{selectedTask.title}</div>
              </div>
              {selectedTask.run_state && <RunStateBadge state={displayRunState(selectedTask)} alive={liveTasks[selectedTask.id]} />}
            </div>

            {/* Review verdict — highlighted banner shown when a PR-review task
                is done and a structured verdict was recorded (or derivable from
                the final gate's log). Includes the "create fix task" button for
                needs_changes / reject verdicts. */}
            {(() => {
              const effective = selectedTask.state === 'done' ? effectiveVerdict(selectedTask) : null;
              if (!effective) return null;
              const meta = {
                pass: { label: t('task.verdictPass'), cls: 'border-green-500/40 bg-green-500/10 text-green-600', Icon: CheckCircle2 },
                needs_changes: { label: t('task.verdictNeedsChanges'), cls: 'border-amber-500/40 bg-amber-500/10 text-amber-600', Icon: AlertTriangle },
                reject: { label: t('task.verdictReject'), cls: 'border-red-500/40 bg-red-500/10 text-red-600', Icon: XCircle },
              }[effective];
              const Icon = meta.Icon;
              const needsFix = effective === 'needs_changes' || effective === 'reject';
              return (
                <>
                  <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${meta.cls}`}>
                    <Icon className="icon-anim h-4 w-4 shrink-0" />
                    {meta.label}
                  </div>
                  {needsFix && (
                    <button
                      onClick={() => setFixTarget(selectedTask)}
                      disabled={fixingId === selectedTask.id}
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
                    >
                      {fixingId === selectedTask.id ? <Loader2 className="icon-anim h-4 w-4 animate-spin" /> : <Settings className="icon-anim h-4 w-4" />}
                      {t('task.createFixTask')}
                    </button>
                  )}
                </>
              );
            })()}

            {/* Failure banner — shown when the task is blocked/failed. Pulls the
                reason from the most recent failure event if present; otherwise,
                for an orchestrator, lists the subtasks that failed. This is what
                surfaces "which subtask failed and why" even when the run was
                interrupted (e.g. server restart) before the close event fired. */}
            {selectedTask.state === 'blocked' && (() => {
              const failEv = [...taskEvents].reverse().find((ev) =>
                ev.type === 'task_status' && (ev.payload as Record<string, unknown>).ok === false);
              const reason = failEv
                ? String((failEv.payload as Record<string, unknown>).reason ?? '')
                : '';
              const failedChildren = tasks.filter((x: Task) =>
                x.parent_id === selectedTask.id && x.state === 'blocked');
              // The last run's exit code — the most concrete signal of why a
              // leaf subtask failed when no reason event was recorded (e.g. the
              // process was interrupted before the close event fired).
              const lastRun = taskRuns[taskRuns.length - 1];
              const exitCode = lastRun?.exit_code ?? null;
              return (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="icon-anim mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-semibold">{t('task.failed')}</div>
                    {reason && <div className="mt-0.5 text-xs text-destructive/90">{reason}</div>}
                    {!reason && failedChildren.length > 0 && (
                      <div className="mt-0.5 text-xs text-destructive/90">
                        {t('task.failedSubtasks')}: {failedChildren.map((c) => c.title).join(', ')}
                      </div>
                    )}
                    {!reason && failedChildren.length === 0 && exitCode !== null && (
                      <div className="mt-0.5 text-xs text-destructive/90">
                        {t('task.exitCode', { code: exitCode })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Git strategy + working directory for an orchestrator (parent)
                task. Shows whether it uses a worktree, a branch, or no git
                isolation, plus the directory it works in. */}
            {!selectedTask.parent_id && (() => {
              const strat = selectedTask.git_strategy || detail.mission.git_strategy;
              const workdir = selectedTask.worktree_path
                ? selectedTask.worktree_path
                : project?.path;
              return (
                <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-xs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <GitBranch className="icon-anim h-3.5 w-3.5" />
                    <span className="font-medium">{t('task.gitStrategy')}:</span>
                    <span className="capitalize">{strat === 'worktree' ? t('task.worktree') : strat === 'branch' ? t('task.branch') : t('task.none')}</span>
                    {selectedTask.branch ? <span className="text-muted-foreground/70">· {selectedTask.branch}</span> : null}
                  </div>
                  {workdir && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Folder className="icon-anim h-3.5 w-3.5" />
                      <span className="font-medium">{t('task.workdir')}:</span>
                      <span className="font-mono break-all text-foreground/80">{workdir}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Subagent badge for a subtask (its assigned recipe). */}
            {selectedTask.parent_id && recipeTitle(selectedTask.agent_type) && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-primary">
                  {recipeTitle(selectedTask.agent_type)}
                </span>
              </div>
            )}

            {/* Spec / plan — collapsible. For a subtask, its description IS its
                spec, so it's labelled "Spec / Plan" and expanded by default.
                For a parent, the generated SDD (spec) is shown collapsed by
                default; the user-written description stays above. */}
            {selectedTask.parent_id ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5">
                <button
                  onClick={() => setSubtaskSpecOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase text-primary"
                >
                  <span>{t('task.spec')}</span>
                  {subtaskSpecOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                {subtaskSpecOpen && (
                  <p className="whitespace-pre-wrap border-t border-primary/20 px-3 py-2 text-xs leading-relaxed text-foreground/90">
                    {selectedTask.description || <span className="text-muted-foreground">{t('task.noDescription')}</span>}
                  </p>
                )}
              </div>
            ) : (
              <>
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm font-medium text-muted-foreground">
                    <span>{t('task.description')}</span>
                    {!hasChildren(selectedTask) && (
                      <button
                        type="button"
                        onClick={() => { setEditTaskDesc(selectedTask.description ?? ''); }}
                        disabled={isPlanning}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50 disabled:hover:no-underline"
                      >
                        <Pencil className="icon-anim h-3 w-3" /> {t('common.edit')}
                      </button>
                    )}
                  </div>
                  {editTaskDesc !== null && !hasChildren(selectedTask) ? (
                    <div className="space-y-2">
                      <textarea
                        value={editTaskDesc}
                        onChange={(e) => setEditTaskDesc(e.target.value)}
                        rows={4}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditTaskDesc(null)}>{t('common.cancel')}</Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            void api.updateTask(selectedTask.id, { description: editTaskDesc }).then((updated) => {
                              setSelectedTask(updated);
                              if (id) void api.getMission(id).then((d) => setDetail(d));
                              setEditTaskDesc(null);
                            });
                          }}
                        >
                          {t('common.save')}
                        </Button>
                      </div>
                    </div>
                  ) : selectedTask.description ? (
                    <p className="text-sm">{selectedTask.description}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground/60">{t('task.noDescription')}</p>
                  )}
                </div>
                {selectedTask.spec && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5">
                    <button
                      onClick={() => setSpecOpen((v) => !v)}
                      className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase text-primary"
                    >
                      <span>{t('task.spec')}</span>
                      {specOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                    {specOpen && (
                      <p className="whitespace-pre-wrap border-t border-primary/20 px-3 py-2 text-xs leading-relaxed text-foreground/90">
                        {selectedTask.spec}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            {selectedTask.parent_id && (() => {
              const parent = tasks.find((x: Task) => x.id === selectedTask.parent_id);
              return parent ? (
                <div className="rounded-lg border border-border/60 bg-muted/30 p-2 text-sm">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">{t('task.parent')}: </span>
                  <button
                    onClick={() => setSelectedTask(parent)}
                    className="font-medium text-primary hover:underline"
                  >
                    {parent.title}
                  </button>
                </div>
              ) : null;
            })()}

            {(() => {
              const children = tasks.filter((x: Task) => x.parent_id === selectedTask.id);
              if (children.length === 0) return null;
              return (
                <div>
                  <div className="mb-1 text-sm font-medium text-muted-foreground">
                    {t('task.subtasks')} ({children.length})
                  </div>
                  <div className="space-y-1.5">
                    {children.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedTask(c)}
                        className="flex w-full items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 p-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                        <span className="flex-1 truncate font-medium">{c.title}</span>
                        {c.run_state && <RunStateBadge state={displayRunState(c)} alive={liveTasks[c.id]} />}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {taskEvents.length > 0 && (
              <div>
                <div className="mb-1 text-sm font-medium text-muted-foreground">{t('task.history')}</div>
                <div className="max-h-40 space-y-1.5 overflow-y-auto">
                  {taskEvents.map((ev, i) => {
                    const desc = describeEvent(ev);
                    // Skip no-op transitions (e.g. repeated todo→todo saves).
                    if (desc === null) return null;
                    return (
                      <div key={i} className="flex flex-col gap-0.5 rounded-md border border-border/50 bg-muted/20 p-2 text-xs">
                        <div className="flex items-center gap-2 text-muted-foreground/70">
                          <span className="shrink-0 tabular-nums">{new Date(ev.created_at).toLocaleString()}</span>
                          <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-medium">{ev.type}</span>
                        </div>
                        <span className="text-foreground/80">{desc}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Run output (logs) for this task — the agent's actual stdout/stderr.
                For an orchestrator with no runs of its own, we surface the
                aggregated subtask output, so show the block when we have it. */}
            {(taskRuns.length > 0 || taskLogs.length > 0) && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <div className="text-sm font-medium text-muted-foreground">{t('task.output')}</div>
                    <button
                      onClick={() => setOutputModalOpen(true)}
                      title={t('task.expandOutput')}
                      aria-label={t('task.expandOutput')}
                      className="rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Maximize2 className="icon-anim h-3.5 w-3.5" />
                    </button>
                  </div>
                  {taskRuns.length > 0 && (
                    <div className="text-[10px] text-muted-foreground/60">
                      {taskRuns.length} run{taskRuns.length > 1 ? 's' : ''} · exit {taskRuns[taskRuns.length - 1].exit_code ?? '—'}
                    </div>
                  )}
                </div>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border/50 bg-black/40 p-2 font-mono text-[11px] leading-relaxed">
                  {taskLogs.length === 0 ? (
                    <div className="text-muted-foreground/60">{t('task.noOutput')}</div>
                  ) : (
                    taskLogs
                      .filter((l) => !(l.source === 'system' && l.message.startsWith('Spawning task subagent')))
                      .map((l, i) => (
                        <div key={i} className={`whitespace-pre-wrap ${l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-yellow-400' : 'text-foreground/80'}`}>
                          {l.message}
                        </div>
                      ))
                  )}
                </div>
              </div>
            )}

            {selectedTask.agent_type && (
              <div>
                <div className="mb-1 text-sm font-medium text-muted-foreground">{t('task.providerModel')}</div>
                <Badge variant="outline">{agentLabel(selectedTask)}</Badge>
              </div>
            )}

            {/* Dependencies: a subtask can depend on sibling subtasks (e.g.
                "document the code" needs "review the code" first). Only shown
                for subtasks that have siblings. */}
            {selectedTask.parent_id && (() => {
              const siblings = tasks.filter((x: Task) => x.parent_id === selectedTask.parent_id && x.id !== selectedTask.id);
              if (siblings.length === 0) return null;
              const current: string[] = (() => {
                try { return JSON.parse(selectedTask.depends_on || '[]'); } catch { return []; }
              })();
              const toggleDep = (depId: string) => {
                const next = current.includes(depId)
                  ? current.filter((d) => d !== depId)
                  : [...current, depId];
                const depTitle = siblings.find((s) => s.id === depId)?.title ?? depId;
                const adding = current.includes(depId) ? false : true;
                setPendingDep({ depId, next, adding, title: depTitle });
              };
              return (
                <div>
                  <div className="mb-1 text-sm font-medium text-muted-foreground">{t('task.dependsOn')}</div>
                  {depSaved && (
                    <div className="mb-2 rounded-md border border-green-500/40 bg-green-500/10 px-2 py-1 text-xs text-green-600">
                      {t('task.depSaved')}
                    </div>
                  )}
                  <div className="space-y-1">
                    {siblings.map((s) => (
                      <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-sm hover:bg-accent">
                        <input
                          type="checkbox"
                          checked={current.includes(s.id)}
                          onChange={() => void toggleDep(s.id)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        <span className="flex-1 truncate">{s.title}</span>
                        {s.state === 'done' && <span className="text-xs text-green-600">✓</span>}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Modal shown when a depends-on change would create a cycle.
                Stays open until the user dismisses it. */}
            {depError && (
              <ConfirmDialog
                open
                title={t('task.depCycleTitle')}
                message={depError}
                confirmLabel={t('common.cancel')}
                destructive={false}
                hideCancel
                onConfirm={() => setDepError(null)}
                onCancel={() => setDepError(null)}
              />
            )}

            {/* Confirm a depends-on change before applying it. */}
            {pendingDep && (
              <ConfirmDialog
                open
                title={t('task.depConfirmTitle')}
                message={pendingDep.adding
                  ? t('task.depConfirmAdd', { dep: pendingDep.title })
                  : t('task.depConfirmRemove', { dep: pendingDep.title })}
                confirmLabel={t('common.confirm')}
                destructive={false}
                onConfirm={() => void applyDep()}
                onCancel={() => setPendingDep(null)}
              />
            )}

            {/* Subagents of an orchestrator (parent) task. Editable until the
                plan is generated (no subtasks yet); readonly once subtasks
                exist (the breakdown is locked). When planned, the subagents are
                derived from the subtasks' agent_type. */}
            {!selectedTask.parent_id && allRecipes.length > 0 && (() => {
              const planned = hasChildren(selectedTask);
              const current: string[] = (() => {
                try { return JSON.parse(selectedTask.subagent_ids || '[]'); } catch { return []; }
              })();
              // When planned, the effective subagents are the recipes assigned
              // to the subtasks (agent_type), not the (empty) subagent_ids.
              const effective = planned
                ? Array.from(new Set(
                    tasks.filter((x: Task) => x.parent_id === selectedTask.id)
                      .map((x) => x.agent_type)
                      .filter((n): n is string => !!n)
                  ))
                : current;
              const toggleSubagent = async (recipeName: string) => {
                const next = current.includes(recipeName)
                  ? current.filter((x) => x !== recipeName)
                  : [...current, recipeName];
                try {
                  const updated = await api.updateTask(selectedTask.id, { subagentIds: next });
                  setSelectedTask(updated);
                  if (id) void api.getMission(id).then((d) => setDetail(d));
                } catch (e) { console.error('update subagents failed', e); }
              };
              return (
                <div>
                  <div className="mb-1 flex items-center justify-between text-sm font-medium text-muted-foreground">
                    <span>{t('task.subagents')}</span>
                    {planned && <span className="text-[10px] text-muted-foreground/70">{t('task.subagentsLocked')}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allRecipes.map((r) => {
                      const on = effective.includes(r.name);
                      if (planned) {
                        return on ? (
                          <span key={r.id} className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                            {r.title}
                          </span>
                        ) : null;
                      }
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => void toggleSubagent(r.name)}
                          disabled={isPlanning}
                          className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:bg-accent'} disabled:opacity-50 disabled:hover:bg-transparent`}
                        >
                          {r.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* The state is not user-changeable — it's driven by the run
                (play/stop). It's shown via the RunStateBadge above. */}

            {/* Create PR (done non-review task with a branch/worktree) */}
            {canCreatePr(selectedTask) && (
              <CreatePrButton task={selectedTask} onOpen={setPrModalTask} variant="full" />
            )}

            {/* Delete task — only for top-level tasks, not subtasks */}
            {!selectedTask.parent_id && (
              <button
                onClick={() => {
                  setConfirmDeleteTask(selectedTask);
                  // If the task owns a worktree/branch, first ask whether to
                  // delete it; otherwise go straight to the final confirm.
                  const ownWorktree = selectedTask.worktree_path && mission?.worktree_path !== selectedTask.worktree_path;
                  const ownBranch = selectedTask.branch && project?.branch !== selectedTask.branch;
                  setDeleteStep(ownWorktree || ownBranch ? 'worktree' : 'confirm');
                }}
                disabled={isPlanning}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:hover:bg-destructive/5"
              >
                <Trash2 className="icon-anim h-4 w-4" /> {t('common.delete')}
              </button>
            )}

            {/* Orchestrator task actions: if it has no subtasks yet AND is still
                in `todo`, show "generate plan & subtasks". Once subtasks exist,
                show play. While planning (locally or persisted in run_state,
                which survives a page refresh) show the spinner instead. If the
                plan failed, show a Retry button (re-runs the planner). The
                "generate plan" button only ever appears in the `todo` state —
                a blocked/failed/doing orchestrator never shows it. */}
            {!selectedTask.parent_id && selectedTask.state !== 'done' && (
              needsPlan(selectedTask) && selectedTask.state === 'todo' ? (
                (() => {
                  const chosenSubagents: string[] = (() => {
                    try { return JSON.parse(selectedTask.subagent_ids || '[]'); } catch { return []; }
                  })();
                  const noSubagents = chosenSubagents.length === 0;
                  return (
                    <div className="space-y-1.5">
                      <button
                        onClick={() => void planTask(selectedTask)}
                        disabled={noSubagents || planningIds.has(selectedTask.id) || selectedTask.run_state === 'planning'}
                        className={`flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-60 ${
                          selectedTask.run_state === 'failed'
                            ? 'border-sky-500/40 bg-sky-500/10 text-sky-600 hover:bg-sky-500/20'
                            : 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/10'
                        }`}
                      >
                        {planningIds.has(selectedTask.id) || selectedTask.run_state === 'planning' ? (
                          <Loader2 className="icon-anim h-4 w-4 animate-spin" />
                        ) : selectedTask.run_state === 'failed' ? (
                          <RotateCcw className="icon-anim h-4 w-4" />
                        ) : (
                          <Brain className="icon-anim h-4 w-4" />
                        )} {selectedTask.run_state === 'failed' ? t('task.retry') : t('task.plan')}
                      </button>
                      {noSubagents && (
                        <p className="text-center text-[11px] text-amber-600">{t('task.planNeedsSubagent')}</p>
                      )}
                    </div>
                  );
                })()
              ) : isRunning(selectedTask) ? (
                <button
                  onClick={() => void stopTask(selectedTask)}
                  disabled={stoppingId === selectedTask.id}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
                >
                  {stoppingId === selectedTask.id ? (
                    <Loader2 className="icon-anim h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="icon-anim h-4 w-4" />
                  )} {t('task.stop')}
                </button>
              ) : (
                <button
                  onClick={() => void runTask(selectedTask)}
                  disabled={startingId === selectedTask.id}
                  className={`flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60 ${
                    selectedTask.run_state === 'failed'
                      ? 'border border-sky-500/40 bg-sky-500/10 text-sky-600 hover:bg-sky-500/20'
                      : 'bg-primary text-primary-foreground hover:bg-green-600'
                  }`}
                >
                  {startingId === selectedTask.id ? (
                    <Loader2 className="icon-anim h-4 w-4 animate-spin" />
                  ) : selectedTask.run_state === 'failed' ? (
                    <RotateCcw className="icon-anim h-4 w-4" />
                  ) : (
                    <Play className="icon-anim h-4 w-4" />
                  )} {selectedTask.run_state === 'failed' ? t('task.retry') : t('task.run')}
                </button>
              )
            )}

            {/* Commit & push the task's changes — shown ONLY when the task is
                `done` AND there is still unpushed work (uncommitted changes or
                commits not yet pushed). Whitelist of "show" states: anything not
                `done` (running, todo, blocked, failed, planning, paused...) never
                shows it. */
                (() => {
                const isReviewTask = !!selectedTask.review_pr_project_id && !!selectedTask.review_pr_number;
                const readyToCommit =
                  selectedTask.state === 'done' &&
                  !isReviewTask &&
                  !!taskSource &&
                  (taskSource.files.length > 0 || taskSource.ahead > 0);
                if (!readyToCommit) return null;
                return (
              <>
                {taskCommitNote && (
                  <div className={`text-xs ${taskCommitNote.startsWith(t('task.commitPushError').split('{')[0]) ? 'text-red-500' : 'text-green-600'}`}>
                    {taskCommitNote}
                  </div>
                )}
                <textarea
                  value={taskCommitMsg}
                  onChange={(e) => setTaskCommitMsg(e.target.value)}
                  placeholder={t('task.commitPlaceholder')}
                  rows={2}
                  className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={() => void commitAndPushTask()}
                  disabled={taskCommitBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
                >
                  {taskCommitBusy ? <Loader2 className="icon-anim h-4 w-4 animate-spin" /> : <GitCommit className="icon-anim h-4 w-4" />}
                  {t('task.commitPush')}
                </button>
              </>
                );
              })()}

            {/* For a completed PR-review task, offer to post the verdict back to the PR.
                If the PR is already merged, skip the comment button and just offer
                to open the PR (or show a "Merged" label). */}
            {selectedTask.state === 'done' && selectedTask.review_pr_project_id && selectedTask.review_pr_number && (
              <>
                {commentNote && (
                  <div className={`text-xs ${commentNote.startsWith(t('office.commentPostError').split('{')[0]) ? 'text-red-500' : 'text-green-600'}`}>
                    {commentNote}
                  </div>
                )}
                {prState === 'MERGED' ? (
                  <>
                    <div className="flex w-full items-center justify-center gap-2 rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm font-medium text-green-600">
                      <CheckCircle2 className="icon-anim h-4 w-4" /> {t('task.prMerged')}
                    </div>
                    <button
                      onClick={() => navigate(`/pr/${selectedTask.review_pr_project_id}/${selectedTask.review_pr_number}`)}
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
                    >
                      <ExternalLink className="icon-anim h-4 w-4" /> {t('task.openPr')}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => void postCommentToPr()}
                      disabled={postingComment}
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
                    >
                      {postingComment ? <Loader2 className="icon-anim h-4 w-4 animate-spin" /> : <GitPullRequest className="icon-anim h-4 w-4" />}
                      {t('office.addCommentToPr')}
                    </button>
                    {/* After posting the comment, offer to open the PR to decide merge/reopen. */}
                    {commentNote && !commentNote.startsWith(t('office.commentPostError').split('{')[0]) && (
                      <button
                        onClick={() => navigate(`/pr/${selectedTask.review_pr_project_id}/${selectedTask.review_pr_number}`)}
                        className="flex w-full items-center justify-center gap-2 rounded-md border border-border/60 bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
                      >
                        <ExternalLink className="icon-anim h-4 w-4" /> {t('task.openPr')}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </BottomSheet>

      {/* Fix-task branch choice modal — ask whether to work on the SAME PR
          branch or a NEW branch derived from it. */}
      {fixTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setFixTarget(null)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold">{t('task.fixBranchTitle')}</h2>
            <p className="mb-4 text-xs text-muted-foreground">{t('task.fixBranchHint')}</p>
            <div className="space-y-2">
              <button
                onClick={() => { const t = fixTarget; setFixTarget(null); void createFixTask(t, 'same'); }}
                disabled={fixingId === fixTarget.id}
                className="flex w-full items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-left hover:bg-accent disabled:opacity-50"
              >
                <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-medium">{t('task.fixBranchSame')}</span>
                  <span className="block text-xs text-muted-foreground">{t('task.fixBranchSameHint')}</span>
                </span>
              </button>
              <button
                onClick={() => { const t = fixTarget; setFixTarget(null); void createFixTask(t, 'new'); }}
                disabled={fixingId === fixTarget.id}
                className="flex w-full items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 text-left hover:bg-accent disabled:opacity-50"
              >
                <Folder className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-medium">{t('task.fixBranchNew')}</span>
                  <span className="block text-xs text-muted-foreground">{t('task.fixBranchNewHint')}</span>
                </span>
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setFixTarget(null)} className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create PR modal for a completed task */}
      {prModalTask && mission && (
        <CreatePrModal
          task={prModalTask}
          missionId={mission.id}
          projectId={mission.project_id}
          projectName={null}
          onClose={() => setPrModalTask(null)}
          onCreated={(url) => {
            setCommentNote(`PR created: ${url}`);
            // Refresh the mission detail AND the open task modal so the
            // Create-PR button flips to "View PR" immediately (the task now
            // carries pr_url).
            void api.getMission(mission.id).then((d) => {
              setDetail(d);
              setSelectedTask((cur) => (cur ? (d.tasks.find((x: Task) => x.id === cur.id) ?? cur) : cur));
            });
          }}
        />
      )}

      {/* New orchestrator task modal */}
      {newTaskOpen && (
        <NewTaskModal
          missionId={id}
          onClose={() => setNewTaskOpen(false)}
          onCreate={async (data) => {
            if (!id) return;
            try {
              await api.createTask(id, {
                title: data.title,
                description: data.description,
                state: 'todo',
                parentId: null,
                dependsOn: [],
                agent: { type: 'hermes' },
                gitStrategy: data.gitStrategy,
                branch: data.branch || null,
                driver: { profile: data.profile, model: data.model, provider: data.provider },
                subagentIds: data.subagentIds,
              });
              await api.getMission(id).then((d) => setDetail(d));
              setNewTaskOpen(false);
            } catch (e) {
              console.error('createTask failed', e);
            }
          }}
        />
      )}

      {/* Confirmations */}
      <ConfirmDialog
        open={confirmDeleteMission}
        title={t('mission.deleteTitle')}
        message={t('mission.deleteMsg', { name: mission.name })}
        onConfirm={() => { void deleteMission(mission.id).then(() => navigate(`/project/${mission.project_id}`)); }}
        onCancel={() => setConfirmDeleteMission(false)}
      />
      <ConfirmDialog
        open={!!confirmDeleteTask}
        title={deleteStep === 'worktree' ? t('task.deleteWorktreeTitle') : t('task.deleteTitle')}
        message={deleteStep === 'worktree'
          ? t('task.deleteWorktreeAsk', { name: confirmDeleteTask?.title ?? '' })
          : t('task.deleteMsg', { name: confirmDeleteTask?.title ?? '' })}
        confirmLabel={deleteStep === 'worktree' ? t('task.deleteWorktreeAndTask') : undefined}
        secondaryConfirmLabel={deleteStep === 'worktree' ? t('task.deleteTaskOnly') : undefined}
        onSecondaryConfirm={() => {
          // Step 1 secondary: delete the task but KEEP the worktree.
          if (confirmDeleteTask) {
            void deleteTask(confirmDeleteTask.id, { removeWorktree: false }).then(() => {
              setSelectedTask(null);
              setDeleteStep(null);
              toast.success(t('toast.taskDeleted'));
              if (id) void api.getMission(id).then((d) => setDetail(d));
            });
          }
        }}
        onConfirm={() => {
          if (deleteStep === 'worktree') {
            // Step 1 primary: delete the task AND its worktree.
            if (confirmDeleteTask) {
              void deleteTask(confirmDeleteTask.id, { removeWorktree: true }).then(() => {
                setSelectedTask(null);
                setDeleteStep(null);
                toast.success(t('toast.taskDeleted'));
                if (id) void api.getMission(id).then((d) => setDetail(d));
              });
            }
            return;
          }
          if (confirmDeleteTask) {
            void deleteTask(confirmDeleteTask.id).then(() => {
              setSelectedTask(null);
              setDeleteStep(null);
              toast.success(t('toast.taskDeleted'));
              if (id) void api.getMission(id).then((d) => setDetail(d));
            });
          }
        }}
        onCancel={() => { setConfirmDeleteTask(null); setDeleteStep(null); }}
        >
        {confirmDeleteTask && deleteStep === 'worktree' && (() => {
          // A task owns a worktree when it has its own path different from the
          // mission's shared worktree. It owns a branch when its branch differs
          // from the project's current branch.
          const ownWorktree = confirmDeleteTask.worktree_path && mission?.worktree_path !== confirmDeleteTask.worktree_path;
          const ownBranch = confirmDeleteTask.branch && project?.branch !== confirmDeleteTask.branch;
          if (!ownWorktree && !ownBranch) return null;
          return (
            <div className="mb-3 space-y-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs">
              {ownWorktree && (
                <div className="break-all font-mono text-muted-foreground">
                  {t('task.deleteWorktreePath')}: {confirmDeleteTask.worktree_path}
                </div>
              )}
              {ownBranch && (
                <div className="break-all font-mono text-muted-foreground">
                  {t('task.deleteBranchName')}: {confirmDeleteTask.branch}
                </div>
              )}
              <div className="text-destructive/90">{t('task.deleteWorktreeWarning')}</div>
            </div>
          );
        })()}
      </ConfirmDialog>

      {/* Edit mission */}
      {editMissionOpen && (
        <BottomSheet open onClose={() => setEditMissionOpen(false)} title={t('mission.editTitle')}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">{t('newMission.name')}</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">{t('newMission.objective')}</label>
              <textarea value={editObjective} onChange={(e) => setEditObjective(e.target.value)} rows={4} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <Button
              onClick={() => {
                void api.updateMission(mission.id, { name: editName, objective: editObjective }).then(() => {
                  setEditMissionOpen(false);
                  if (id) void api.getMission(id).then((d) => setDetail(d));
                });
              }}
              className="w-full"
            >
              {t('common.save')}
            </Button>
          </div>
        </BottomSheet>
      )}

      {/* Expanded output modal — full-size view of the task's logs */}
      {outputModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setOutputModalOpen(false)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
              <span className="truncate text-sm font-semibold">
                {selectedTask?.title ?? ''} — {t('task.output')}
              </span>
              <button onClick={() => setOutputModalOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label={t('common.close')}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-black/90 p-3 font-mono text-xs leading-relaxed">
              {taskLogs.length === 0 ? (
                <div className="text-muted-foreground/60">{t('task.noOutput')}</div>
              ) : (
                taskLogs
                  .filter((l) => !(l.source === 'system' && l.message.startsWith('Spawning task subagent')))
                  .map((l, i) => (
                    <div key={i} className={`whitespace-pre-wrap ${l.level === 'error' ? 'text-red-400' : l.level === 'warn' ? 'text-yellow-400' : 'text-foreground/80'}`}>
                      {l.message}
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type NewTaskData = {
  title: string;
  description: string;
  gitStrategy: 'worktree' | 'branch' | 'none';
  branch: string;
  profile: string;
  model: string;
  provider: string;
  subagentIds: string[];
};

function NewTaskModal({
  missionId, onClose, onCreate,
}: {
  missionId?: string;
  onClose: () => void;
  onCreate: (data: NewTaskData) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gitStrategy, setGitStrategy] = useState<'worktree' | 'branch' | 'none'>('worktree');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<Array<{ name: string; current: boolean }>>([]);
  const [profile, setProfile] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [subagentIds, setSubagentIds] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Array<{ name: string; provider: string }>>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [recipes, setRecipes] = useState<SubagentRecipe[]>([]);
  const [saving, setSaving] = useState(false);

  // Load profiles, providers, and subagent recipes on mount.
  useEffect(() => {
    void api.listHermesProfiles().then((r) => {
      setProfiles(r.profiles);
      if (r.profiles.length > 0) {
        setProfile(r.profiles[0].name);
        setProvider(r.profiles[0].provider);
      }
    });
    void api.listHermesProviders().then((r) => setProviders(r.providers));
    void api.listRecipes().then((r) => setRecipes(r.recipes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When branch strategy is selected, load the repo's branches.
  useEffect(() => {
    if (gitStrategy === 'branch' && missionId) {
      void api.listMissionBranches(missionId).then((r) => {
        setBranches(r.branches);
        const current = r.branches.find((b) => b.current);
        if (current) setBranch((cur) => cur || current.name);
      }).catch(() => setBranches([]));
    }
  }, [gitStrategy, missionId]);

  // When profile changes, adopt its provider.
  useEffect(() => {
    const prof = profiles.find((p) => p.name === profile);
    if (prof?.provider && prof.provider !== provider) setProvider(prof.provider);
  }, [profile, profiles, provider]);

  // When provider changes, fetch models. Keep the current model if it's still
  // in the list, else pick the first.
  useEffect(() => {
    if (!provider) { setModels([]); setModel(''); return; }
    void api.listHermesModels(provider).then((r) => {
      setModels(r.models);
      setModel((cur) => (cur && r.models.includes(cur) ? cur : (r.models[0] || '')));
    });
  }, [provider]);

  const toggleSubagent = (id: string) => {
    setSubagentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={modalSheetCls}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-bold">{t('task.add')}</h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('task.title')}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('task.description')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Orchestrator config */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('task.orchestrator')}</label>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {[...profiles].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('newMission.provider')}</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {[...providers].sort((a, b) => a.localeCompare(b)).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('newMission.model')}</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {[...models].sort((a, b) => a.localeCompare(b)).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Git strategy */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('task.gitStrategy')}</label>
            <div className="flex gap-2">
              {(['worktree', 'branch', 'none'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setGitStrategy(s)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${gitStrategy === s ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Branch (only for branch strategy) */}
          {gitStrategy === 'branch' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('task.branch')}</label>
              <input
                list="hermes-commander-branch-options"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder={t('task.branchPlaceholder')}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
              />
              <datalist id="hermes-commander-branch-options">
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>{b.current ? '● ' : ''}{b.name}</option>
                ))}
              </datalist>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {branches.length > 0
                  ? `${branches.length} ${t('task.branchesAvailable')} — ${t('task.branchNewHint')}`
                  : t('task.branchNewHint')}
              </p>
            </div>
          )}

          {/* Subagents multi-select */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('task.subagents')}</label>
            <div className="flex flex-wrap gap-1.5">
              {[...recipes].sort((a, b) => a.title.localeCompare(b.title)).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleSubagent(r.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${subagentIds.includes(r.id) ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent'}`}
                >
                  {r.title}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
            {t('common.cancel')}
          </button>
          <button
            onClick={async () => {
              setSaving(true);
              try {
                await onCreate({ title, description, gitStrategy, branch, profile, model, provider, subagentIds });
              } finally { setSaving(false); }
            }}
            disabled={!title.trim() || !profile || !model || saving}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
