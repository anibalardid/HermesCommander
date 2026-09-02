import { Store } from './db/store.js';

/**
 * Rich demo seed — wipes the DB and generates realistic test cases across the
 * two test repos so every screen of the UI can be exercised and screenshotted:
 *
 *  ani-test-1 (landing page "Nova"):
 *    - Mission "Landing page" (done): orchestrator + subtasks, all done, with
 *      runs/logs and a merged PR.
 *    - Mission "Hero section" (running): a task in-progress with an open PR.
 *    - Mission "Footer" (todo): tasks queued, one blocked.
 *    - Mission "Review PR #3" (done): a review task with verdict + comment.
 *
 *  ani-test-2 (calculator):
 *    - Mission "Calculator" (done): several done tasks + runs/history.
 *    - Mission "Advanced ops" (running): in-progress task with open PR.
 *    - Mission "Unit tests" (todo): queued tasks.
 *    - Mission "Review PR #1" (done): review task with needs_changes verdict.
 *
 * Usage: `HERMES_COMMANDER_DB=<path> npx tsx src/rich-seed.ts`
 */

const REPO1 = '/Users/anibal/Projects/ani-test-1';
const REPO2 = '/Users/anibal/Projects/ani-test-2';

const DRIVER = {
  driver_type: 'hermes',
  driver_profile: null,
  driver_model: 'deepseek-v4-flash:cloud',
  driver_provider: null,
  driver_worktree_flag: 0,
  uses_kanban: 1,
  intervention: 'autonomous' as const,
  depends_on_mission_ids: '[]',
  max_concurrent: null,
};

function mission(store: Store, projectId: string, name: string, objective: string, state: any, extra: any = {}) {
  return store.createMission({
    project_id: projectId, name, objective,
    git_strategy: 'none', base_branch: null, worktree_path: null,
    ...DRIVER, state, session_id: null,
    started_at: state === 'pending' ? null : Date.now() - 3600_000,
    finished_at: state === 'done' || state === 'failed' ? Date.now() - 600_000 : null,
    ...extra,
  });
}

function task(store: Store, missionId: string, title: string, state: any, runState: any, sort: number, extra: any = {}) {
  return store.createTask({
    mission_id: missionId, title, description: null, state, parent_id: null,
    depends_on: '[]', agent_type: 'hermes', agent_llm: 'deepseek-v4-flash:cloud',
    agent_system_prompt: null, sort_order: sort, run_state: runState,
    git_strategy: 'none', branch: null, worktree_path: null, ...extra,
  });
}

function run(store: Store, missionId: string, taskId: string, state: 'done' | 'failed', sort: number, sessionId: string) {
  const r = store.createAgentRun({
    mission_id: missionId, task_id: taskId, agent_type: 'hermes',
    role: 'subagent', llm: 'deepseek-v4-flash:cloud', state,
    finished_at: Date.now() - 600_000, exit_code: state === 'done' ? 0 : 1, session_id: sessionId,
  });
  store.addLog(r.id, 'info', `Spawning task subagent: ${sessionId}`, 'system');
  store.addLog(r.id, state === 'done' ? 'info' : 'error',
    state === 'done' ? 'Task completed successfully.' : 'Task failed: build error in module.',
    state === 'done' ? 'stdout' : 'stderr');
  store.addEvent({ missionId, taskId, type: 'task_status', payload: { before: { state: 'todo', run_state: 'idle' }, after: { state: 'doing', run_state: 'running' } } });
  store.addEvent({ missionId, taskId, type: 'task_status', payload: { before: { state: 'doing', run_state: 'running' }, after: { state, run_state: state === 'done' ? 'done' : 'failed' } } });
  return r;
}

export async function seedRich(store: Store): Promise<string[]> {
  const created: string[] = [];

  // Clean slate: wipe everything.
  for (const p of store.listProjects()) store.deleteProject(p.id);

  const proj1 = store.createProject({ name: 'ani-test-1', path: REPO1, type: 'git', remote_url: null, created_by: 'open', badge_color: null, parent_group: null });
  const proj2 = store.createProject({ name: 'ani-test-2', path: REPO2, type: 'git', remote_url: null, created_by: 'open', badge_color: null, parent_group: null });

  // ============ ani-test-1: Landing page (done) ============
  {
    const m = mission(store, proj1.id, 'Landing page', 'Build the Nova landing page with hero, features and footer.', 'done');
    const t1 = task(store, m.id, 'Orchestrator: build landing page', 'done', 'done', 0);
    run(store, m.id, t1.id, 'done', 0, 'landing-orch');
    const t2 = task(store, m.id, 'Add hero section', 'done', 'done', 1, { parent_id: t1.id });
    run(store, m.id, t2.id, 'done', 1, 'landing-hero');
    const t3 = task(store, m.id, 'Add features grid', 'done', 'done', 2, { parent_id: t1.id });
    run(store, m.id, t3.id, 'done', 2, 'landing-features');
    const t4 = task(store, m.id, 'Add footer', 'done', 'done', 3, { parent_id: t1.id });
    run(store, m.id, t4.id, 'done', 3, 'landing-footer');
    store.addNotification({ type: 'mission_done', title: 'Mission completed', body: 'Landing page', link: `/missions/${m.id}` });
    created.push('Landing page');
  }

  // ============ ani-test-1: Hero section (running, open PR #3) ============
  {
    const m = mission(store, proj1.id, 'Hero section', 'Add a new hero section v2 to the landing page.', 'running', { session_id: 'hero-session' });
    const t1 = task(store, m.id, 'Orchestrator: hero section', 'doing', 'delegating', 0);
    const t2 = task(store, m.id, 'Implement hero markup', 'doing', 'running', 1, { parent_id: t1.id, branch: 'feature/hero-section', pr_url: 'https://github.com/anibalardid/ani-test-1/pull/3' });
    const r = store.createAgentRun({ mission_id: m.id, task_id: t2.id, agent_type: 'hermes', role: 'subagent', llm: 'deepseek-v4-flash:cloud', state: 'running', finished_at: null, exit_code: null, session_id: 'hero-session' });
    store.addLog(r.id, 'info', 'Spawning task subagent: hero-session', 'system');
    store.addLog(r.id, 'info', 'Editing index.html to add hero section...', 'stdout');
    store.addEvent({ missionId: m.id, taskId: t2.id, type: 'task_status', payload: { before: { state: 'todo', run_state: 'idle' }, after: { state: 'doing', run_state: 'running' } } });
    created.push('Hero section');
  }

  // ============ ani-test-1: Footer (todo, one blocked) ============
  {
    const m = mission(store, proj1.id, 'Footer', 'Add a footer section to the landing page.', 'pending');
    const t1 = task(store, m.id, 'Orchestrator: footer', 'todo', 'idle', 0);
    task(store, m.id, 'Add footer markup', 'todo', 'idle', 1, { parent_id: t1.id });
    task(store, m.id, 'Style footer', 'blocked', 'failed', 2, { parent_id: t1.id });
    created.push('Footer');
  }

  // ============ ani-test-1: Review PR #3 (done, review task) ============
  {
    const m = mission(store, proj1.id, 'Review PR #3', 'Review the hero section PR and post a verdict.', 'done');
    const t1 = task(store, m.id, 'Review PR #3', 'done', 'done', 0, {
      review_pr_project_id: proj1.id, review_pr_number: 3, review_verdict: 'pass',
      pr_url: 'https://github.com/anibalardid/ani-test-1/pull/3',
    });
    run(store, m.id, t1.id, 'done', 0, 'review-pr3');
    store.addNotification({ type: 'task_done', title: 'Task completed', body: 'Review PR #3', link: `/missions/${m.id}` });
    created.push('Review PR #3');
  }

  // ============ ani-test-2: Calculator (done) ============
  {
    const m = mission(store, proj2.id, 'Calculator', 'Build a calculator module with tests.', 'done');
    const t1 = task(store, m.id, 'Setup scaffolding', 'done', 'done', 0);
    run(store, m.id, t1.id, 'done', 0, 'calc-setup');
    const t2 = task(store, m.id, 'Implement calculator module', 'done', 'done', 1);
    run(store, m.id, t2.id, 'done', 1, 'calc-module');
    const t3 = task(store, m.id, 'Write unit tests', 'done', 'done', 2);
    run(store, m.id, t3.id, 'done', 2, 'calc-tests');
    const t4 = task(store, m.id, 'Fix flaky integration test', 'blocked', 'failed', 3);
    run(store, m.id, t4.id, 'failed', 3, 'calc-flaky');
    store.addNotification({ type: 'mission_done', title: 'Mission completed', body: 'Calculator', link: `/missions/${m.id}` });
    created.push('Calculator');
  }

  // ============ ani-test-2: Advanced ops (running, open PR #1) ============
  {
    const m = mission(store, proj2.id, 'Advanced ops', 'Add power and modulo operations to the calculator.', 'running', { session_id: 'adv-session' });
    const t1 = task(store, m.id, 'Orchestrator: advanced ops', 'doing', 'delegating', 0);
    const t2 = task(store, m.id, 'Implement power and modulo', 'doing', 'running', 1, { parent_id: t1.id, branch: 'feature/advanced-calculator', pr_url: 'https://github.com/anibalardid/ani-test-2/pull/1' });
    const r = store.createAgentRun({ mission_id: m.id, task_id: t2.id, agent_type: 'hermes', role: 'subagent', llm: 'deepseek-v4-flash:cloud', state: 'running', finished_at: null, exit_code: null, session_id: 'adv-session' });
    store.addLog(r.id, 'info', 'Spawning task subagent: adv-session', 'system');
    store.addLog(r.id, 'info', 'Editing calculator.py to add power() and modulo()...', 'stdout');
    store.addEvent({ missionId: m.id, taskId: t2.id, type: 'task_status', payload: { before: { state: 'todo', run_state: 'idle' }, after: { state: 'doing', run_state: 'running' } } });
    created.push('Advanced ops');
  }

  // ============ ani-test-2: Unit tests (todo) ============
  {
    const m = mission(store, proj2.id, 'Unit tests', 'Add unit tests for the new calculator operations.', 'pending');
    const t1 = task(store, m.id, 'Orchestrator: unit tests', 'todo', 'idle', 0);
    task(store, m.id, 'Add power tests', 'todo', 'idle', 1, { parent_id: t1.id });
    task(store, m.id, 'Add modulo tests', 'todo', 'idle', 2, { parent_id: t1.id });
    created.push('Unit tests');
  }

  // ============ ani-test-2: Review PR #1 (done, needs_changes) ============
  {
    const m = mission(store, proj2.id, 'Review PR #1', 'Review the advanced calculator PR and post a verdict.', 'done');
    const t1 = task(store, m.id, 'Review PR #1', 'done', 'done', 0, {
      review_pr_project_id: proj2.id, review_pr_number: 1, review_verdict: 'needs_changes',
      pr_url: 'https://github.com/anibalardid/ani-test-2/pull/1',
    });
    run(store, m.id, t1.id, 'done', 0, 'review-pr1');
    store.addNotification({ type: 'task_done', title: 'Task completed', body: 'Review PR #1', link: `/missions/${m.id}` });
    created.push('Review PR #1');
  }

  return created;
}

// Run directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('rich-seed.ts')) {
  const dbPath = process.env.HERMES_COMMANDER_DB ?? 'data/hermes-commander.db';
  const store = new Store(dbPath);
  const created = await seedRich(store);
  console.log(`Seeded rich cases: ${created.join(', ') || 'none'}`);
}
