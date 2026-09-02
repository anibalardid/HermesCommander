import type { Store, MissionRow, TaskRow, SubagentRecipeRow } from '../db/store.js';
import { EventHub } from './ws.js';
import { TmuxSession } from './tmux.js';
import { createWorktree, removeWorktree, listWorktrees } from '../git/worktree.js';
import { checkoutBranch } from '../git/branch.js';
import { spawn } from 'node:child_process';
import { runPlanner, type PlannedSubtask } from './planner.js';
import { notify } from '../notifications.js';

export type MissionControlCommand = 'start' | 'pause' | 'resume' | 'stop' | 'interrupt';

/**
 * MissionRunner spawns one `hermes` process per mission with the flags chosen
 * on the mission (profile/model/provider/worktree). Each mission runs inside a
 * tmux session so the user can redirect/message the agent mid-work (interrupt).
 * Streams output to logs and pushes events over the WebSocket hub.
 * See docs/03-mission-runtime.md.
 */
export class MissionRunner {
  private store: Store;
  private hub: EventHub;
  /** missionId -> tmux session */
  private sessions = new Map<string, TmuxSession>();
  /** missionId -> mission-level agent run id */
  private runIds = new Map<string, string>();
  /** orchestrator task ids currently running (guards against double-run) */
  private runningOrchestrators = new Set<string>();

  constructor(store: Store, hub: EventHub) {
    this.store = store;
    this.hub = hub;
  }

  private buildCommand(m: MissionRow): string {
    const flags = ['chat'];
    if (m.driver_profile) flags.push('-p', m.driver_profile);
    if (m.driver_model) flags.push('-m', m.driver_model);
    if (m.driver_provider) flags.push('--provider', m.driver_provider);
    // The mission's worktree is passed via cwd (session.start), never via -w:
    // -w makes Hermes create its own nested worktree/branch, which subagents
    // must not do. Work happens on the mission's worktree/branch.
    flags.push('-q', this.buildObjective(m), '--quiet', '--source', 'tool', '--max-turns', '50');
    return `hermes ${flags.join(' ')}`;
  }

  /** Build the objective, injecting context from any missions this one depends on. */
  buildObjective(m: MissionRow): string {
    let objective = m.objective;
    const deps = this.parseDeps(m.depends_on_mission_ids);
    if (deps.length > 0) {
      const depContext = deps
        .map((id) => {
          const dep = this.store.getMission(id);
          return dep ? `- [${dep.name}] (state: ${dep.state}) ${dep.objective}` : `- [unknown mission ${id}]`;
        })
        .join('\n');
      objective += `\n\nContext from dependent missions:\n${depContext}`;
    }
    // If the mission uses the kanban, tell the orchestrator it can report tasks.
    if (m.uses_kanban) {
      objective +=
        `\n\nYou are running as the orchestrator for this mission. ` +
        `You may report task progress to the Hermes Commander kanban by POSTing to ` +
        `http://127.0.0.1:4310/api/missions/${m.id}/tasks/sync with a JSON body ` +
        `{"tasks":[{"title":"...","state":"todo|doing|blocked|done","description":"...","agentType":"..."}]}. ` +
        `Use this to keep the board in sync as you delegate and complete work.`;
    }
    return objective;
  }

  private parseDeps(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Check that all missions this one depends on are done. */
  depsSatisfied(m: MissionRow): { ok: boolean; reason?: string } {
    const deps = this.parseDeps(m.depends_on_mission_ids);
    for (const id of deps) {
      const dep = this.store.getMission(id);
      if (!dep) return { ok: false, reason: `dependency mission ${id} not found` };
      if (dep.state !== 'done') {
        return { ok: false, reason: `dependency '${dep.name}' is not done (state: ${dep.state})` };
      }
    }
    return { ok: true };
  }

  async start(missionId: string): Promise<{ ok: boolean; reason?: string }> {
    const m = this.store.getMission(missionId);
    if (!m) return { ok: false, reason: 'mission not found' };
    if (this.sessions.has(missionId)) return { ok: false, reason: 'already running' };

    // Block start until all dependency missions are done.
    const deps = this.depsSatisfied(m);
    if (!deps.ok) {
      this.store.addEvent({ missionId, projectId: m.project_id, type: 'error', payload: { error: deps.reason } });
      this.hub.emit('mission', missionId, 'error', { error: deps.reason });
      return { ok: false, reason: deps.reason };
    }

    // Enforce the per-project concurrency cap (soft, default 5, editable per mission).
    const cap = m.max_concurrent ?? 5;
    const running = this.store.countRunningMissions(m.project_id);
    if (running >= cap) {
      this.store.addEvent({ missionId, projectId: m.project_id, type: 'error', payload: { error: `concurrency cap reached (${running}/${cap})` } });
      this.hub.emit('mission', missionId, 'error', { error: `concurrency cap reached (${running}/${cap})` });
      return { ok: false, reason: `concurrency cap reached (${running}/${cap})` };
    }

    const run = this.store.createAgentRun({
      mission_id: missionId, task_id: null, agent_type: m.driver_type,
      role: 'driver', llm: m.driver_model, state: 'running', finished_at: null,
      exit_code: null, session_id: null,
    });
    this.runIds.set(missionId, run.id);
    this.store.updateMission(missionId, { state: 'running', started_at: Date.now() });
    this.store.addEvent({ missionId, projectId: m.project_id, type: 'state_change', payload: { state: 'running' } });
    this.hub.emit('mission', missionId, 'state_change', { state: 'running' });

    const cmd = this.buildCommand(m);
    this.store.addLog(run.id, 'info', `Spawning (tmux): ${cmd}`, 'system');

    const session = new TmuxSession(missionId);
    this.sessions.set(missionId, session);
    try {
      await session.start(cmd, m.worktree_path ?? undefined);
    } catch (err) {
      this.store.addLog(run.id, 'error', `tmux start failed: ${(err as Error).message}`, 'system');
      this.store.finishAgentRun(run.id, 'failed', 1);
      this.store.updateMission(missionId, { state: 'failed', finished_at: Date.now() });
      this.sessions.delete(missionId);
      notify(this.store, this.hub, 'mission_failed', 'Mission failed', m.name, `/missions/${missionId}`);
      return { ok: false, reason: `tmux start failed: ${(err as Error).message}` };
    }

    // Poll the tmux pane for output and stream it as logs/events.
    this.poll(missionId, run.id, session);
    return { ok: true };
  }

  private poll(missionId: string, runId: string, session: TmuxSession): void {
    let lastLen = 0;
    const timer = setInterval(async () => {
      // If the tmux session is gone, the command finished — mark the run done.
      if (!(await session.isAlive())) {
        clearInterval(timer);
        this.timers.delete(missionId);
        this.sessions.delete(missionId);
        this.store.finishAgentRun(runId, 'done', 0);
        this.store.updateMission(missionId, { state: 'done', finished_at: Date.now() });
        this.store.addEvent({ missionId, type: 'state_change', payload: { state: 'done' } });
        this.hub.emit('mission', missionId, 'state_change', { state: 'done' });
        const doneMission = this.store.getMission(missionId);
        notify(this.store, this.hub, 'mission_done', 'Mission completed', doneMission?.name ?? 'Mission', `/missions/${missionId}`);
        return;
      }
      const pane = await session.capture();
      if (pane.length > lastLen) {
        const newText = pane.slice(lastLen);
        lastLen = pane.length;
        this.store.addLog(runId, 'info', newText, 'stdout');
        this.hub.emit('mission', missionId, 'log', { level: 'info', text: newText, source: 'stdout' });
      }
    }, 1000);

    // Store the timer so we can clear it on stop.
    this.timers.set(missionId, timer);
  }

  private timers = new Map<string, NodeJS.Timeout>();

  async pause(missionId: string): Promise<void> {
    await this.sessions.get(missionId)?.pause();
    this.store.updateMission(missionId, { state: 'paused' });
    this.store.addEvent({ missionId, type: 'state_change', payload: { state: 'paused' } });
    this.hub.emit('mission', missionId, 'state_change', { state: 'paused' });
  }

  async resume(missionId: string): Promise<void> {
    // tmux C-z pauses; to resume we send a newline / fg. Simplest: send Enter.
    await this.sessions.get(missionId)?.send('');
    this.store.updateMission(missionId, { state: 'running' });
    this.store.addEvent({ missionId, type: 'state_change', payload: { state: 'running' } });
    this.hub.emit('mission', missionId, 'state_change', { state: 'running' });
  }

  async stop(missionId: string): Promise<void> {
    const timer = this.timers.get(missionId);
    if (timer) clearInterval(timer);
    this.timers.delete(missionId);
    await this.sessions.get(missionId)?.kill();
    this.sessions.delete(missionId);
    this.store.updateMission(missionId, { state: 'cancelled', finished_at: Date.now() });
    this.store.addEvent({ missionId, type: 'state_change', payload: { state: 'cancelled' } });
    this.hub.emit('mission', missionId, 'state_change', { state: 'cancelled' });
  }

  /** Redirect / message the agent mid-work via tmux send-keys. */
  async interrupt(missionId: string, message: string): Promise<void> {
    const session = this.sessions.get(missionId);
    if (session) {
      await session.send(message);
      this.store.addLog(this.runIds.get(missionId) ?? '', 'info', `[user] ${message}`, 'system');
    }
    this.store.addEvent({ missionId, type: 'agent_msg', payload: { from: 'user', message } });
    this.hub.emit('mission', missionId, 'agent_msg', { from: 'user', message });
  }

  async createWorktreeForMission(missionId: string): Promise<string | null> {
    const m = this.store.getMission(missionId);
    if (!m || m.git_strategy !== 'worktree') return null;
    const project = this.store.getProject(m.project_id);
    if (!project) return null;
    const path = await createWorktree(project.path, m.name);
    // Run the project's setup script (if any) inside the fresh worktree so env
    // vars / configs are copied in before any subagent works there.
    if (project.setup_script?.trim()) {
      await this.runSetupScript(project.setup_script, path, m.id);
    }
    return path;
  }

  /** Execute a project's setup script (bash) in the given worktree dir. */
  private async runSetupScript(script: string, cwd: string, missionId: string): Promise<void> {
    const run = this.store.createAgentRun({
      mission_id: missionId, task_id: null, agent_type: 'setup', role: 'driver',
      llm: null, state: 'running', finished_at: null, exit_code: null, session_id: null,
    });
    this.store.addLog(run.id, 'info', 'Running project setup script in worktree', 'system');
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const exec = promisify(execFile);
      const { stdout, stderr } = await exec('bash', ['-c', script], { cwd, timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
      if (stdout) this.store.addLog(run.id, 'info', stdout, 'stdout');
      if (stderr) this.store.addLog(run.id, 'warn', stderr, 'stderr');
      this.store.finishAgentRun(run.id, 'done', 0);
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      if (e.stdout) this.store.addLog(run.id, 'info', e.stdout, 'stdout');
      if (e.stderr) this.store.addLog(run.id, 'error', e.stderr, 'stderr');
      this.store.addLog(run.id, 'error', `setup script failed: ${e.message ?? 'unknown'}`, 'system');
      this.store.finishAgentRun(run.id, 'failed', 1);
    }
  }

  async cleanupWorktreeForMission(missionId: string): Promise<void> {
    const m = this.store.getMission(missionId);
    if (!m || !m.worktree_path) return;
    await removeWorktree(m.worktree_path);
  }

  private taskProcesses = new Map<string, ReturnType<typeof spawn>>();
  private taskRunIds = new Map<string, string>();

  /**
   * Resolve the effective orchestrator config for a task. In the
   * model, the config (driver profile/model/provider, git strategy, worktree)
   * lives on the PARENT (orchestrator) task. Subtasks inherit it from their
   * parent; a parent task uses its own config. Falls back to the mission's
   * driver for backward compatibility with older data.
   */
  private resolveTaskConfig(task: TaskRow): {
    profile: string | null; model: string | null; provider: string | null;
    gitStrategy: 'worktree' | 'branch' | 'none' | null; worktreePath: string | null; branch: string | null;
  } {
    const mission = this.store.getMission(task.mission_id);
    const parent = task.parent_id ? this.store.getTask(task.parent_id) : undefined;
    const cfg = parent ?? task;
    return {
      profile: cfg.driver_profile ?? mission?.driver_profile ?? null,
      model: cfg.driver_model ?? mission?.driver_model ?? null,
      provider: cfg.driver_provider ?? mission?.driver_provider ?? null,
      gitStrategy: cfg.git_strategy ?? mission?.git_strategy ?? null,
      worktreePath: cfg.worktree_path ?? mission?.worktree_path ?? null,
      branch: cfg.branch ?? null,
    };
  }

  /**
   * True when a task (or its parent orchestrator) is a PR review, OR when the
   * task's subagent is a review-type recipe (agent_type name contains
   * "review"). Used to hardcode the structured-verdict instruction into
   * subtask prompts so the parent summary can always extract a PASS / NEEDS
   * CHANGES / REJECT verdict regardless of the user's original prompt.
   */
  private isReviewContext(task: TaskRow): boolean {
    if (task.review_pr_project_id && task.review_pr_number) return true;
    if (task.parent_id) {
      const parent = this.store.getTask(task.parent_id);
      if (parent && parent.review_pr_project_id && parent.review_pr_number) return true;
    }
    // A subtask assigned to a review-named subagent (recipe) is a review too.
    if (task.agent_type && /review/i.test(task.agent_type)) return true;
    return false;
  }

  /**
   * Create the worktree for an orchestrator (parent) task. The worktree lives
   * OUTSIDE the project folder (one level up) so it doesn't show up as an
   * untracked file inside the repo. Runs the project's setup script inside it.
   */
  async createWorktreeForTask(taskId: string): Promise<string | null> {
    const task = this.store.getTask(taskId);
    if (!task) return null;
    const cfg = this.resolveTaskConfig(task);
    if (cfg.gitStrategy !== 'worktree') return null;
    const mission = this.store.getMission(task.mission_id);
    const project = mission ? this.store.getProject(mission.project_id) : undefined;
    if (!project) return null;

    // A fix task for a PR review must reuse the review's worktree/branch so
    // the fix lands on the SAME PR branch, not a new one. If the task already
    // has a worktree (e.g. createFixTask preloaded it), use it as-is — but only
    // if it's actually a valid git worktree. A stale/plain directory (e.g. a
    // leftover from a failed worktree creation) is NOT usable; fall through and
    // resolve the real one below.
    // NOTE: a fix task created on a NEW branch (base_branch set) must NOT reuse
    // the PR's worktree — it gets its own worktree derived from base_branch.
    if (task.worktree_path && !task.base_branch) {
      const existing = await listWorktrees(project.path);
      const isRegistered = existing.some((w) => w.path === task.worktree_path);
      if (isRegistered) {
        return task.worktree_path;
      }
    }
    // Otherwise, if this is a fix of a review (same PR) on the SAME branch,
    // find the review task in the same mission and reuse its worktree/branch.
    if (task.review_pr_project_id && task.review_pr_number && !task.base_branch) {
      const review = this.store
        .listTasks(task.mission_id)
        .find((t) =>
          t.id !== task.id &&
          t.review_pr_project_id === task.review_pr_project_id &&
          t.review_pr_number === task.review_pr_number &&
          t.worktree_path,
        );
      if (review?.worktree_path) {
        this.store.updateTask(taskId, { worktree_path: review.worktree_path, branch: review.branch });
        return review.worktree_path;
      }
    }

    // If the task targets a specific branch (e.g. a PR head branch) that is
    // ALREADY checked out in an existing worktree, reuse that worktree instead
    // of creating a new one. Otherwise `createWorktree` would fall back to a
    // NEW derived branch (mission/<title>) because git refuses two worktrees on
    // the same branch — leaving the fix on a throwaway branch instead of the PR.
    // A fix on a NEW branch (base_branch set) skips this: it needs its own
    // worktree derived from base_branch.
    if (cfg.branch && !task.base_branch) {
      const existing = await listWorktrees(project.path);
      const match = existing.find((w) => w.branch === cfg.branch);
      if (match?.path) {
        this.store.updateTask(taskId, { worktree_path: match.path, branch: cfg.branch });
        return match.path;
      }
    }

    // For a fix on a NEW branch, create the worktree FROM the base branch
    // (the PR head branch) so the fix starts at the PR's current code.
    const fromBranch = task.base_branch ?? null;
    const path = await createWorktree(project.path, task.title, cfg.branch, fromBranch);
    if (project.setup_script?.trim()) {
      await this.runSetupScript(project.setup_script, path, task.mission_id);
    }
    this.store.updateTask(taskId, { worktree_path: path });
    return path;
  }

  async cleanupWorktreeForTask(taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task || !task.worktree_path) return;
    await removeWorktree(task.worktree_path);
  }

  /**
   * Run a single task as its own subagent. The orchestrator is always Hermes,
   * so we spawn one `hermes` process scoped to this task's objective, working
   * directly in the MISSION's worktree (via cwd — subagents never get -w, so
   * they never create their own nested worktree/branch).
   *
   * Robustness: the task is only marked `done` when the hermes process exits
   * with code 0 AND its output contains a `session_id`, i.e. it actually
   * completed a real turn. A crash, timeout, or spawn failure marks it
   * `blocked|failed` instead — never a premature `done`.
   */
  async runTask(taskId: string): Promise<{ ok: boolean; reason?: string }> {
    const task = this.store.getTask(taskId);
    if (!task) return { ok: false, reason: 'task not found' };
    const mission = this.store.getMission(task.mission_id);
    if (!mission) return { ok: false, reason: 'mission not found' };
    if (this.taskProcesses.has(taskId)) return { ok: false, reason: 'task already running' };
    // Guard against double-running an orchestrator: it runs in the background
    // and is NOT tracked in taskProcesses (only its subtasks are). Without this,
    // a watchdog + manual run (or a double click) would both plan and delete
    // each other's subtasks mid-flight → "task no longer exists".
    if (!task.parent_id && this.runningOrchestrators.has(taskId)) {
      return { ok: false, reason: 'orchestrator already running' };
    }

    // ORCHESTRATOR RULE: a parent task (no parent_id) is an orchestrator. It
    // NEVER applies changes itself — it only plans and delegates. So running
    // it means: (1) plan the breakdown if it has no subtasks yet, then
    // (2) execute each subtask as its own subagent in dependency order.
    // This runs in the background (fire-and-forget) so the HTTP request returns
    // immediately; the board updates live over the WebSocket as subtasks run.
    if (!task.parent_id) {
      void this.runOrchestrator(task, mission);
      return { ok: true };
    }

    // Otherwise this is a leaf subtask — run it directly as a subagent.
    return this.runSubtask(task, mission);
  }

  /**
   * Orchestrator flow: plan (if needed) then delegate every subtask in
   * dependency order. The orchestrator itself never executes code — it only
   * creates the plan and dispatches subagents. Marks itself done only when all
   * subtasks are done.
   */
  private async runOrchestrator(task: TaskRow, mission: MissionRow): Promise<{ ok: boolean; reason?: string }> {
    // Register as running so a concurrent runTask call is rejected (see guard
    // in runTask). Cleaned up in the finally below.
    this.runningOrchestrators.add(task.id);
    try {
      return await this.runOrchestratorInner(task, mission);
    } finally {
      this.runningOrchestrators.delete(task.id);
    }
  }

  private async runOrchestratorInner(task: TaskRow, mission: MissionRow): Promise<{ ok: boolean; reason?: string }> {
    // Mark as delegating so the board reflects the orchestrator is working.
    const prevState = task.state;
    const prevRun = task.run_state;
    const updated = this.store.updateTask(task.id, { state: 'doing', run_state: 'delegating' });
    // Record a history event only if the visible run state actually changed.
    if (prevState !== updated.state || prevRun !== updated.run_state) {
      this.store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { before: { state: prevState, run_state: prevRun }, after: { state: updated.state, run_state: updated.run_state, title: updated.title } } });
    }
    this.hub.emit('mission', mission.id, 'task_status', { task: this.store.getTask(task.id) });

    // 1. Ensure the orchestrator has a worktree (if its git strategy needs one).
    const cfg = this.resolveTaskConfig(task);
    if (cfg.gitStrategy === 'worktree' && !cfg.worktreePath) {
      await this.createWorktreeForTask(task.id);
    }

    // 2. Plan the breakdown if the orchestrator has no subtasks yet.
    const children = this.store.listTasks(mission.id).filter((t) => t.parent_id === task.id);
    if (children.length === 0) {
      const plan = await this.planAndBreakdown(mission.id, task.id);
      if (!plan.ok) {
        this.store.updateTask(task.id, { state: 'blocked', run_state: 'failed' });
        this.store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { state: 'blocked', ok: false, reason: `plan failed: ${plan.reason}` } });
        this.hub.emit('mission', mission.id, 'task_status', { task: this.store.getTask(task.id) });
        return { ok: false, reason: plan.reason };
      }
    }

    // 3. Delegate: run each subtask in dependency order. A subtask only runs
    //    once all of its depends_on siblings are done. Already-done subtasks
    //    are skipped (idempotent re-run). A failed subtask marks the
    //    orchestrator failed with the reason.
    const allChildren = this.store.listTasks(mission.id).filter((t) => t.parent_id === task.id);
    const parseDeps = (raw: string): string[] => {
      try { return JSON.parse(raw) as string[]; } catch { return []; }
    };
    // Re-read the current state of every child on each pass so a subtask that
    // just finished is seen as `done` by its dependents (allChildren is a
    // snapshot and would otherwise keep stale states, falsely blocking the
    // next subtask).
    const currentState = (id: string): string => {
      const cur = this.store.getTask(id);
      return cur ? cur.state : 'done';
    };
    const remaining = allChildren.filter((c) => c.state !== 'done');
    let guard = 0;
    while (remaining.length > 0 && guard < 100) {
      guard += 1;
      const ready = remaining.filter((c) => {
        const deps = parseDeps(c.depends_on);
        return deps.every((d) => {
          const dep = allChildren.find((x) => x.id === d);
          return dep ? currentState(dep.id) === 'done' : true; // unknown dep → treat as satisfied
        });
      });
      if (ready.length === 0) {
        // Circular or unsatisfiable dependency — mark blocked with a reason.
        const stuck = remaining.map((c) => c.title).join(', ');
        this.store.updateTask(task.id, { state: 'blocked', run_state: 'failed' });
        this.store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { state: 'blocked', ok: false, reason: `dependency cycle or unsatisfiable deps on: ${stuck}` } });
        this.hub.emit('mission', mission.id, 'task_status', { task: this.store.getTask(task.id) });
        return { ok: false, reason: `dependency cycle on: ${stuck}` };
      }
      // Run every ready subtask IN PARALLEL (they have no unmet deps among
      // themselves), then wait for all of them before recomputing the next
      // ready batch. This is what lets independent subtasks execute
      // concurrently instead of one-at-a-time.
      const results = await Promise.all(ready.map((child) => this.runSubtask(child, mission)));
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const failedChild = ready[results.findIndex((r) => !r.ok)];
        this.store.updateTask(task.id, { state: 'blocked', run_state: 'failed' });
        this.store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { state: 'blocked', ok: false, reason: `subtask "${failedChild?.title ?? '?'}" failed: ${failed.reason ?? 'unknown'}` } });
        this.hub.emit('mission', mission.id, 'task_status', { task: this.store.getTask(task.id) });
        return { ok: false, reason: failed.reason };
      }
      for (const child of ready) {
        const idx = remaining.findIndex((x) => x.id === child.id);
        if (idx >= 0) remaining.splice(idx, 1);
      }
    }

    // 4. All subtasks done → orchestrator done.
    this.store.updateTask(task.id, { state: 'done', run_state: 'done' });
    this.store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { state: 'done', ok: true } });
    this.hub.emit('mission', mission.id, 'task_status', { task: this.store.getTask(task.id) });
    return { ok: true };
  }

  /** Run a single leaf subtask as its own subagent. */
  private async runSubtask(task: TaskRow, mission: MissionRow): Promise<{ ok: boolean; reason?: string }> {
    if (this.taskProcesses.has(task.id)) return { ok: false, reason: 'task already running' };

    // Resolve the orchestrator config (driver + git strategy + worktree) from
    // the parent task (or the task itself if it's a parent), falling back to
    // the mission for older data.
    const cfg = this.resolveTaskConfig(task);

    // If the task uses a worktree strategy but doesn't have one yet, create it
    // now (outside the project folder) so the subagent has an isolated place
    // to work. This is what makes per-parent-task worktrees work on run.
    if (cfg.gitStrategy === 'worktree' && !cfg.worktreePath) {
      await this.createWorktreeForTask(task.id);
    }

    // If the task uses a branch strategy, check out the requested branch
    // (creating it from the current HEAD if it doesn't exist) in the project
    // repo so the subagent works on that branch.
    if (cfg.gitStrategy === 'branch' && cfg.branch) {
      const project = this.store.getProject(mission.project_id);
      if (project?.path) {
        await checkoutBranch(project.path, cfg.branch);
      }
    }

    // Mark the task as in-progress and emit so the board updates live.
    const prevState = task.state;
    const prevRun = task.run_state;
    const started = this.store.updateTask(task.id, { state: 'doing', run_state: 'running' });
    // The task may have been deleted while the orchestrator was running (e.g.
    // the user removed it mid-run). updateTask returns undefined in that case —
    // bail out instead of crashing the whole runner.
    if (!started) {
      return { ok: false, reason: 'task no longer exists' };
    }
    // Record a history event when execution begins (idle → running).
    if (prevState !== started.state || prevRun !== started.run_state) {
      this.store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { before: { state: prevState, run_state: prevRun }, after: { state: started.state, run_state: started.run_state, title: started.title } } });
    }
    this.hub.emit('mission', mission.id, 'task_status', { task: this.store.getTask(task.id) });

    const run = this.store.createAgentRun({
      mission_id: mission.id, task_id: task.id, agent_type: task.agent_type ?? 'hermes',
      role: 'subagent', llm: task.agent_llm ?? cfg.model, state: 'running', finished_at: null,
      exit_code: null, session_id: null,
    });
    this.taskRunIds.set(task.id, run.id);

    // Build a task-scoped objective: the task title + description, plus the
    // mission context so the subagent knows what it's part of. If the task has
    // its own system prompt (from a recipe), prepend it as the role definition.
    const prompt = task.agent_system_prompt
      ? `You are acting as "${task.agent_type ?? 'subagent'}".\n${task.agent_system_prompt}\n\n`
      : '';
    // Work happens on the orchestrator's worktree (or the project path). Hermes
    // ignores the process cwd (it uses its own config cwd), so we must tell the
    // agent explicitly where to work.
    const workDir = cfg.worktreePath ?? (() => { const p = this.store.getProject(mission.project_id); return p?.path; })();
    // PR-review subtasks always require a structured verdict, hardcoded here so
    // the parent summary can extract it reliably — independent of the user's
    // prompt. Detects review context on the task itself or its parent.
    const reviewLine = this.isReviewContext(task)
      ? 'This is a CODE REVIEW of a pull request. End your report with a single line exactly like one of:\nVERDICT: PASS\nVERDICT: NEEDS CHANGES\nVERDICT: REJECT\nChoose based on whether the review found the PR acceptable, needs changes, or should be rejected.'
      : '';
    const objective = [
      `You are executing a single task within the mission "${mission.name}".`,
      `Task: ${task.title}`,
      task.description ? `Description: ${task.description}` : '',
      `Mission objective (context): ${mission.objective}`,
      workDir ? `Work in this directory: ${workDir}. Create all files there and use absolute paths.` : '',
      reviewLine,
      'Complete this task and report back concisely.',
    ].filter(Boolean).join('\n');

    const flags = ['chat'];
    // Per-task profile/provider/model override the orchestrator; otherwise inherit.
    const llm = task.agent_llm ?? cfg.model;
    const provider = task.agent_provider ?? cfg.provider;
    const profile = task.agent_profile ?? cfg.profile;
    if (profile) flags.push('-p', profile);
    if (llm) flags.push('-m', llm);
    if (provider) flags.push('--provider', provider);
    if (workDir) flags.push('--in', workDir);
    // No -w: subagents never create their own nested worktree/branch.
    flags.push('-q', `${prompt}${objective}`, '--quiet', '--source', 'tool', '--max-turns', '30');

    const cmd = `hermes ${flags.join(' ')}`;
    const cwd = workDir;
    this.store.addLog(run.id, 'info', `Spawning task subagent: ${cmd} (cwd: ${cwd})`, 'system');

    const proc = spawn('hermes', flags, { cwd, env: { ...process.env, HOME: process.env.HOME ?? '' } });

    // Only mark done when the process finishes OK. Track completion here so the
    // poll loop (below) can rely on the captured output before finalizing.
    let captured = '';
    proc.stdout.on('data', (d) => { captured += d.toString(); this.store.addLog(run.id, 'info', d.toString(), 'stdout'); this.hub.emit('mission', mission.id, 'log', { level: 'info', text: d.toString(), source: 'stdout' }); });
    proc.stderr.on('data', (d) => { captured += d.toString(); this.store.addLog(run.id, 'info', d.toString(), 'stderr'); this.hub.emit('mission', mission.id, 'log', { level: 'info', text: d.toString(), source: 'stderr' }); });

    this.taskProcesses.set(task.id, proc);

    // Resolve when the process actually finishes, so the orchestrator can
    // sequence subtasks in dependency order. Returns the real outcome.
    return await new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      proc.on('error', (err) => {
        this.store.addLog(run.id, 'error', `spawn failed: ${(err as Error).message}`, 'system');
        this.finishTask(task.id, run.id, mission.id, false);
        resolve({ ok: false, reason: (err as Error).message });
      });

      proc.on('close', (code) => {
        this.taskProcesses.delete(task.id);
        // Real completion requires exit 0 AND a session_id line (Hermes answered).
        const ok = code === 0 && /session_id:\s*\S+/.test(captured);
        if (code !== 0) {
          this.store.addLog(run.id, 'error', `hermes exited with code ${code}`, 'system');
        }
        this.finishTask(task.id, run.id, mission.id, ok, code ?? undefined, captured);
        resolve({ ok, reason: ok ? undefined : `hermes exited with code ${code ?? 'unknown'}` });
      });
    });
  }

  /** Finalize a task run based on real process outcome. */
  private finishTask(taskId: string, runId: string, missionId: string, ok: boolean, code?: number, captured?: string): void {
    const task = this.store.getTask(taskId);
    if (!task) return;
    // A subtask (has a parent) is reported as a "subtask", not a "task", so the
    // notification bell distinguishes leaf work from orchestrator work.
    const isSubtask = !!task.parent_id;
    if (ok) {
      this.store.finishAgentRun(runId, 'done', 0);
      // Keep the session_id for telemetry if present.
      const m = captured?.match(/session_id:\s*(\S+)/);
      if (m) this.store.updateRunSessionId(runId, m[1]);
      this.store.updateTask(taskId, { state: 'done', run_state: 'done' });
      this.store.addEvent({ missionId, taskId, type: 'task_status', payload: { state: 'done', ok: true } });
      notify(this.store, this.hub, isSubtask ? 'subtask_done' : 'task_done', isSubtask ? 'Subtask completed' : 'Task completed', task.title, `/missions/${missionId}`);
    } else {
      this.store.finishAgentRun(runId, 'failed', code ?? 1);
      this.store.updateTask(taskId, { state: 'blocked', run_state: 'failed' });
      this.store.addEvent({ missionId, taskId, type: 'task_status', payload: { state: 'blocked', ok: false, code } });
      notify(this.store, this.hub, isSubtask ? 'subtask_failed' : 'task_failed', isSubtask ? 'Subtask failed' : 'Task failed', task.title, `/missions/${missionId}`);
    }
    this.hub.emit('mission', missionId, 'task_status', { task: this.store.getTask(taskId) });
    if (ok) this.maybeGenerateParentReport(missionId, taskId);
  }

  async stopTask(taskId: string): Promise<void> {
    const proc = this.taskProcesses.get(taskId);
    if (proc) proc.kill('SIGTERM');
    this.taskProcesses.delete(taskId);
    const runId = this.taskRunIds.get(taskId);
    if (runId) this.store.finishAgentRun(runId, 'interrupted', 1);
    const task = this.store.getTask(taskId);
    if (task) {
      this.store.updateTask(taskId, { state: 'blocked', run_state: 'paused' });
      this.hub.emit('mission', task.mission_id, 'task_status', { task: this.store.getTask(taskId) });
    }
  }

  async stopAll(): Promise<void> {
    for (const [id] of this.sessions) {
      await this.stop(id);
    }
    for (const [taskId] of this.taskProcesses) {
      await this.stopTask(taskId);
    }
  }

  /**
   * Run the planner (one-shot Hermes, no code execution) and materialize the
   * breakdown as subtasks hanging off the given orchestrator task. Resolves each
   * subtask's agent fields from the matching recipe (provider/model/prompt),
   * inheriting from the mission driver where the recipe doesn't override.
   * Returns the created subtasks.
   */
  async planAndBreakdown(
    missionId: string,
    parentTaskId: string
  ): Promise<{ ok: boolean; subtasks?: TaskRow[]; reason?: string }> {
    const mission = this.store.getMission(missionId);
    const parent = this.store.getTask(parentTaskId);
    if (!mission) return { ok: false, reason: 'mission not found' };
    if (!parent) return { ok: false, reason: 'parent task not found' };

    // The planner runs with the parent task's orchestrator config (driver +
    // git strategy), not the mission's — the parent owns the execution.
    const cfg = this.resolveTaskConfig(parent);
    // The objective the planner works from is the PARENT TASK's title +
    // description (the user's request), not the mission's generic objective.
    const objective = [parent.title, parent.description].filter(Boolean).join('\n\n');
    // If the task was previously blocked/failed, surface the error output so the
    // planner can plan subtasks that specifically address the failure.
    const context: string[] = [];
    if (parent.state === 'blocked' || parent.run_state === 'failed') {
      let errorOutput = '';
      const runs = this.store.listRunsForTask(parent.id);
      for (const run of runs.reverse()) {
        const logs = this.store.listLogsForRun(run.id) as Array<{ level: string; source: string; message: string }>;
        for (const log of logs) {
          if (log.level === 'error' || log.level === 'warn' || log.source === 'stderr') {
            errorOutput += `[${log.level}/${log.source}] ${log.message}\n`;
          }
        }
        if (errorOutput.length > 3000) break;
      }
      if (errorOutput) {
        context.push(`Consider the previous error output (this task was blocked/failed):\n${errorOutput.trim()}`);
      }
    }
    const res = await runPlanner(this.store, mission, cfg, objective, context, parent.subagent_ids ? JSON.parse(parent.subagent_ids) : undefined);
    if (!res.ok) return { ok: false, reason: res.reason };

    // Persist the overall spec (SDD) on the parent task.
    if (res.spec) {
      this.store.updateTask(parent.id, { spec: res.spec });
    }

    const recipes = this.store.listRecipes();
    const byName = new Map(recipes.map((r) => [r.name, r]));
    const created: TaskRow[] = [];

    // Idempotency: remove any existing subtasks of this parent before recreating
    // the breakdown, so re-running the plan doesn't duplicate the tree.
    const priorChildren = this.store.listTasks(missionId).filter((t) => t.parent_id === parent.id);
    for (const c of priorChildren) {
      this.store.deleteTask(c.id);
    }

    let existing = this.store.listTasks(missionId);

    for (const s of res.subtasks ?? []) {
      const recipe = s.agentType ? byName.get(s.agentType) : undefined;
      // If agentType names a recipe, stamp its provider/model/prompt onto the task.
      const task = this.store.createTask({
        mission_id: missionId,
        title: s.title,
        description: s.description ?? null,
        state: 'todo',
        run_state: 'idle',
        parent_id: parent.id,
        depends_on: '[]',
        agent_type: recipe?.name ?? s.agentType ?? null,
        agent_llm: s.agentModel ?? recipe?.model ?? cfg.model,
        agent_provider: s.agentProvider ?? recipe?.provider ?? cfg.provider,
        agent_profile: recipe?.profile ?? null,
        agent_system_prompt: recipe?.system_prompt ?? null,
        sort_order: existing.length + created.length,
      });
      // Set depends_on after creating all so we can reference sibling ids by title.
      created.push(task);
    }

    // Second pass: wire depends_on by title.
    for (const t of created) {
      const s = (res.subtasks ?? []).find((x) => x.title === t.title);
      if (s?.dependsOnTitles && s.dependsOnTitles.length > 0) {
        const ids = s.dependsOnTitles
          .map((title) => {
            const dep = created.find((c) => c.title === title);
            return dep ? dep.id : null;
          })
          .filter((x): x is string => !!x);
        if (ids.length > 0) {
          const updated = this.store.updateTask(t.id, { depends_on: JSON.stringify(ids) });
          this.hub.emit('mission', missionId, 'task_status', { task: updated });
        }
      }
      this.hub.emit('mission', missionId, 'task_created', { task: t });
    }

    // The orchestrator task stays idle after planning — it only moves to
    // `delegating` when it actually starts delegating (runOrchestrator).
    this.hub.emit('mission', missionId, 'task_status', { task: this.store.getTask(parent.id) });

    return { ok: true, subtasks: created };
  }

  /**
   * Fire-and-forget async planning for an orchestrator task. Marks the task
   * `run_state: 'planning'` (persisted, so it survives a page refresh), runs
   * the planner in the background, then clears the state and emits events so
   * the board updates live over the WebSocket. Returns immediately so the
   * HTTP request doesn't block on the (slow) Hermes planner call.
   */
  async planTaskAsync(taskId: string): Promise<{ ok: boolean; reason?: string }> {
    const task = this.store.getTask(taskId);
    if (!task) return { ok: false, reason: 'task not found' };
    // Guard: don't double-plan a task that's already planning.
    if (task.run_state === 'planning') return { ok: false, reason: 'task already planning' };
    // Guard: an orchestrator task must have at least one subagent selected
    // before it can generate a plan — otherwise the planner would fall back to
    // ALL recipes, ignoring the user's intent.
    const chosen: string[] = task.subagent_ids ? JSON.parse(task.subagent_ids) : [];
    if (chosen.length === 0) {
      return { ok: false, reason: 'no subagents selected' };
    }

    // Persist the planning state so a refresh keeps showing the spinner.
    this.store.updateTask(taskId, { run_state: 'planning' });
    this.hub.emit('mission', task.mission_id, 'task_status', { task: this.store.getTask(taskId) });

    // Run the planner in the background; the HTTP call returns immediately.
    void (async () => {
      try {
        const result = await this.planAndBreakdown(task.mission_id, taskId);
        if (!result.ok) {
          // Mark the task blocked/failed so the UI shows a Retry button
          // (mirrors runOrchestrator's failure handling).
          this.store.updateTask(taskId, { state: 'blocked', run_state: 'failed' });
          this.store.addEvent({ missionId: task.mission_id, taskId, type: 'task_status', payload: { state: 'blocked', ok: false, reason: `plan failed: ${result.reason}` } });
          this.hub.emit('mission', task.mission_id, 'task_status', { task: this.store.getTask(taskId) });
          return;
        }
        // On success the subtasks are created; the parent returns to idle.
        this.store.updateTask(taskId, { run_state: 'idle' });
        this.hub.emit('mission', task.mission_id, 'task_status', { task: this.store.getTask(taskId) });
      } catch (e) {
        this.store.updateTask(taskId, { state: 'blocked', run_state: 'failed' });
        this.store.addEvent({ missionId: task.mission_id, taskId, type: 'task_status', payload: { state: 'blocked', ok: false, reason: `plan failed: ${(e as Error).message}` } });
        this.hub.emit('mission', task.mission_id, 'task_status', { task: this.store.getTask(taskId) });
      }
    })();

    return { ok: true };
  }

  /**
   * When a subtask completes, check whether ALL subtasks of its parent
   * orchestrator are now done. If so, run a one-shot Hermes "summary" pass over
   * the completed work and store the resulting report as the parent task's
   * description (ready for a PR or commit message). Idempotent: only runs once.
   */
  private async maybeGenerateParentReport(missionId: string, completedTaskId: string): Promise<void> {
    const completed = this.store.getTask(completedTaskId);
    if (!completed || !completed.parent_id) return;
    const parent = this.store.getTask(completed.parent_id);
    if (!parent) return;

    // Only auto-report on orchestrator parents (they are the task without a parent).
    if (parent.parent_id) return;
    // Don't re-run if a report already exists on the parent — EXCEPT for PR
    // reviews, which always need a structured verdict generated even if the
    // task already has a description (e.g. the review objective).
    const isReviewTask = !!(parent.review_pr_project_id && parent.review_pr_number);
    if (!isReviewTask && parent.description && parent.description.length > 20) return;

    const siblings = this.store.listTasks(missionId).filter((t) => t.parent_id === parent.id);
    const allDone = siblings.length > 0 && siblings.every((t) => t.state === 'done');
    if (!allDone) return;

    const mission = this.store.getMission(missionId);
    if (!mission) return;

    // Gather a concise summary of what each subtask was and its status.
    const lines = siblings.map((t) => `- ${t.title}${t.description ? `: ${t.description}` : ''} (done)`).join('\n');
    const isReview = !!(parent.review_pr_project_id && parent.review_pr_number);
    const prompt = [
      `You are summarizing a completed mission for a pull request / commit message.`,
      `Mission: "${mission.name}"`,
      `Objective: ${mission.objective}`,
      `Completed subtasks:\n${lines}`,
      ``,
      isReview
        ? `This was a CODE REVIEW of a pull request. End your summary with a single line exactly like one of:\nVERDICT: PASS\nVERDICT: NEEDS CHANGES\nVERDICT: REJECT\nChoose based on whether the review found the PR acceptable, needs changes, or should be rejected.`
        : ``,
      `Write a concise (3-6 sentence) summary of the work delivered, suitable for a PR description.`,
      `Return ONLY the summary text, no headers, no markdown bullets.`,
    ].filter(Boolean).join('\n');

    const args = ['chat'];
    const cfg = this.resolveTaskConfig(parent);
    if (cfg.profile) args.push('-p', cfg.profile);
    if (cfg.model) args.push('-m', cfg.model);
    if (cfg.provider) args.push('--provider', cfg.provider);
    args.push('-q', prompt, '--quiet', '--source', 'tool', '--max-turns', '10');

    let report = '';
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const exec = promisify(execFile);
      const { stdout } = await exec('hermes', args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
      report = stdout.trim();
    } catch {
      report = '';
    }

    // For a PR review, extract the structured verdict (PASS / NEEDS CHANGES /
    // REJECT) from the report and store it separately so the UI can highlight
    // it. Strip the verdict line from the stored description.
    let verdict: TaskRow['review_verdict'] = null;
    let cleanReport = report;
    if (isReview) {
      const m = report.match(/VERDICT:\s*(PASS|NEEDS CHANGES|REJECT)/i);
      if (m) {
        const v = m[1].toUpperCase();
        verdict = v === 'PASS' ? 'pass' : v === 'NEEDS CHANGES' ? 'needs_changes' : 'reject';
        cleanReport = report.replace(/VERDICT:\s*(PASS|NEEDS CHANGES|REJECT)/i, '').trim();
      } else {
        // The summary pass didn't emit a verdict (e.g. it failed or returned
        // empty). Fall back to the subtasks' own logs: the final review gate
        // ends with `VERDICT: ...`. Take the LAST verdict line across all
        // subtask logs (each subagent log embeds its instruction prompt, which
        // lists all three options, so the first match is always the prompt's
        // PASS — the real verdict is the gate's, which runs last).
        const verdicts: string[] = [];
        for (const sib of siblings) {
          for (const run of this.store.listRunsForTask(sib.id)) {
            for (const log of this.store.listLogsForRun(run.id) as Array<{ message: string }>) {
              const mm = String(log.message).match(/VERDICT:\s*(PASS|NEEDS CHANGES|REJECT)/i);
              if (mm) verdicts.push(mm[1].toUpperCase());
            }
          }
        }
        if (verdicts.length > 0) {
          const v = verdicts[verdicts.length - 1];
          verdict = v === 'PASS' ? 'pass' : v === 'NEEDS CHANGES' ? 'needs_changes' : 'reject';
        }
      }
    }

    // Store the report on the parent's description and mark the parent done.
    // Even if the summary produced no text, still persist the derived verdict
    // (and keep the existing description) so the review verdict is never lost.
    this.store.updateTask(parent.id, {
      description: cleanReport || parent.description,
      review_verdict: verdict,
      state: 'done',
      run_state: 'done',
    });
    this.store.addEvent({ missionId, taskId: parent.id, type: 'task_status', payload: { report: true, state: 'done', verdict } });
    this.hub.emit('mission', missionId, 'task_status', { task: this.store.getTask(parent.id) });
  }

  /**
   * Stale-state watchdog. After a crash / reboot / lost process, tasks and
   * missions can be left in an "active" run_state (running, delegating,
   * waiting_review, planning, paused, waiting) with NO live process behind
   * them. This scans the DB and flags those rows back to `failed`/`idle` (or
   * `paused` for paused) so the board reflects reality and the user can re-run.
   * Returns the number of rows recovered.
   */
  async watchdog(): Promise<{ tasksRecovered: number; missionsRecovered: number }> {
    let tasksRecovered = 0;
    let missionsRecovered = 0;

    // Stale run_states that mean "something is happening" but with no live process.
    // NOTE: `planning` is deliberately NOT here. A task in `planning` is being
    // planned by planTaskAsync, which runs the planner in the background WITHOUT
    // registering a process in taskProcesses. If the watchdog treated `planning`
    // as stale it would auto-run the task (void this.runTask) the moment the
    // user clicks "generate plan", yanking it from `todo` into `doing`/`delegating`
    // before the user ever pressed Play. Planning is self-managed: planTaskAsync
    // clears the state itself when the planner finishes.
    const activeRunStates = ['running', 'delegating', 'waiting_review'];

    // Also catch a residual state: a task whose `state` is 'doing' but whose
    // run_state fell back to 'idle', with no run ever having started. This is a
    // crash/restart leftover (a task was marked doing, the server died before
    // creating a run or updating run_state) — it blocks the board with
    // "in progress" forever while its subtasks sit idle. Treat it as stale.
    const stale = this.store.listStaleActiveTasks(activeRunStates)
      .concat(this.store.listTasksStuckDoing());
    for (const t of stale) {
      if (this.taskProcesses.has(t.id)) continue; // genuinely running
      // An orchestrator that is currently executing its delegation loop is
      // genuinely working even though it has no process of its own (only its
      // subtasks do). runningOrchestrators is set for the entire duration of
      // runOrchestratorInner, so skip it — otherwise the watchdog can race the
      // orchestrator and mark it failed while a subtask is still running.
      if (this.runningOrchestrators.has(t.id)) continue;
      // An orchestrator in `delegating` has no process of its own — it runs
      // subtasks that DO have processes. It is legitimately working as long as
      // it still has subtasks to run (pending or active). Only mark it failed
      // if every subtask is already done (i.e. it should have finished) or it
      // has no subtasks at all.
      if (t.run_state === 'delegating') {
        const children = this.store.listTasks(t.mission_id).filter((c) => c.parent_id === t.id);
        // A delegating orchestrator is legitimately working as long as it has
        // a subtask actively running (doing) — that's the process doing the
        // work. But if NO subtask is running and there are still pending
        // (todo) subtasks whose deps are satisfied, the orchestrator's process
        // died mid-delegation and the board is stuck: those subtasks will never
        // be launched. Treat that as a stale orchestrator to auto-retry.
        const hasActive = children.some((c) => c.state === 'doing' || c.run_state === 'running');
        const hasFailed = children.some((c) => c.state === 'blocked' || c.run_state === 'failed');
        if (hasActive) continue; // genuinely working
        if (hasFailed) {
          this.store.updateTask(t.id, { state: 'blocked', run_state: 'failed' });
          this.hub.emit('mission', t.mission_id, 'task_status', { task: this.store.getTask(t.id) });
          tasksRecovered++;
          continue;
        }
        // No active subtask and no failed one. If there are pending (todo)
        // subtasks, the orchestrator is stuck (its process died) — fall
        // through to the auto-retry path below. If there are none at all, it
        // should have finished — also fall through to be marked failed.
      }
      const runId = this.taskRunIds.get(t.id);
      if (runId) {
        this.store.addLog(
          runId,
          'warn',
          `watchdog: task "${t.title}" was ${t.run_state} but no process is alive — marking failed/idle`,
          'system'
        );
      }
      // AUTO-RETRY: a task left in an active state with no live process is
      // almost always the result of a server restart / crash / lost process,
      // not a real failure. Retry it once automatically (retry_count < 1)
      // before giving up. This makes the board self-heal after a reboot.
      const retries = t.retry_count ?? 0;
      if (retries < 1) {
        this.store.updateTask(t.id, { retry_count: retries + 1 });
        this.hub.emit('mission', t.mission_id, 'task_status', { task: this.store.getTask(t.id) });
        // Fire-and-forget: re-run the task (orchestrator or leaf) in the
        // background. The board updates live as it progresses.
        void this.runTask(t.id);
        tasksRecovered++;
        continue;
      }
      this.store.updateTask(t.id, { state: t.state === 'doing' ? 'blocked' : t.state, run_state: 'failed' });
      this.hub.emit('mission', t.mission_id, 'task_status', { task: this.store.getTask(t.id) });
      tasksRecovered++;
    }

    // Stale paused/waiting tasks: no process alive, but these were explicitly
    // paused — move to a recoverable `paused`-with-no-process marker.
    const stalePaused = this.store.listStaleActiveTasks(['paused', 'waiting']);
    for (const t of stalePaused) {
      if (this.taskProcesses.has(t.id)) continue;
      this.store.updateTask(t.id, { run_state: 'idle' });
      tasksRecovered++;
    }

    // Stale missions: mission state running but no tmux session for it.
    const runningMissions = this.store.listMissionsByState('running');
    for (const m of runningMissions) {
      if (this.sessions.has(m.id)) continue; // genuinely running
      const runId = this.runIds.get(m.id);
      if (runId) {
        this.store.addLog(
          runId,
          'warn',
          `watchdog: mission "${m.name}" was running but no process is alive — marking failed`,
          'system'
        );
      }
      this.store.updateMission(m.id, { state: 'failed', finished_at: Date.now() });
      this.store.addEvent({ missionId: m.id, type: 'state_change', payload: { state: 'failed', reason: 'watchdog: no live process' } });
      missionsRecovered++;
    }

    return { tasksRecovered, missionsRecovered };
  }

  /**
   * Live status of every task/mission that the runner believes is active.
   * For each, reports whether a real OS process is currently alive behind it
   * (a spawned subagent process for leaf tasks, a tmux session for missions).
   * This lets the UI distinguish "genuinely running" from "stale/crashed"
   * (a task left in running/delegating with no live process after a restart).
   */
  liveStatus(): {
    tasks: Array<{ taskId: string; runState: string; state: string; alive: boolean }>;
    missions: Array<{ missionId: string; state: string; alive: boolean }>;
  } {
    const activeRunStates = ['running', 'delegating', 'planning', 'waiting', 'waiting_review', 'waiting_user', 'paused'];
    const tasks = this.store
      .listStaleActiveTasks(activeRunStates)
      .concat(this.store.listTasksStuckDoing())
      .map((t) => {
        // A task is genuinely alive if it has its own OS process (a leaf
        // subagent). An orchestrator in `delegating`/`planning` has no process
        // of its own — it runs subtasks that DO have processes. Mirror the
        // watchdog's logic: it's legitimately working as long as it still has
        // a subtask actively running (doing) or pending to run. `planning` is
        // a transient state where the orchestrator is running the planner in
        // the background (subtasks don't exist yet), so it's always alive.
        let alive = this.taskProcesses.has(t.id);
        if (!alive && t.run_state === 'planning') {
          alive = true;
        } else if (!alive && t.run_state === 'delegating') {
          const children = this.store.listTasks(t.mission_id).filter((c) => c.parent_id === t.id);
          const hasActive = children.some((c) => c.state === 'doing' || c.run_state === 'running');
          const hasPending = children.some((c) => c.state === 'todo');
          alive = hasActive || hasPending;
        }
        return { taskId: t.id, runState: t.run_state, state: t.state, alive };
      });
    const missions = this.store
      .listMissionsByState('running')
      .map((m) => ({ missionId: m.id, state: m.state, alive: this.sessions.has(m.id) }));
    return { tasks, missions };
  }
}
