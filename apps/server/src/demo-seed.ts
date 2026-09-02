import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Store } from './db/store.js';

/**
 * Demo seed — wipes the throwaway example mission and generates several
 * realistic test cases so the user can exercise every part of the UI:
 *
 *   1. Branch strategy  — a mission whose task works on a feature branch,
 *      with an executed run + logs + an open PR from that branch.
 *   2. Worktree strategy — a mission whose task runs in an isolated worktree,
 *      with an executed run + logs.
 *   3. Runs / history    — a mission with several tasks that have completed
 *      runs (done + failed) and history events, to test the history panel.
 *
 * It also creates the actual git branches and worktrees in the test repos so
 * the Source tab shows real data. Idempotent-ish: it deletes the demo missions
 * it created on a previous run before re-creating them.
 *
 * Usage: `HERMES_COMMANDER_DB=<path> npx tsx src/demo-seed.ts`
 */

const REPO1 = '/Users/anibal/Projects/ani-test-1';
const REPO2 = '/Users/anibal/Projects/ani-test-2';

function git(repo: string, args: string[]) {
  try { execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' }); } catch { /* best effort */ }
}

function ensureBranch(repo: string, branch: string) {
  const branches = execFileSync('git', ['-C', repo, 'branch', '--list', branch]).toString().trim();
  if (!branches) git(repo, ['checkout', '-b', branch]);
}

function ensureWorktree(repo: string, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase();
  const path = `/Users/anibal/Projects/.hermes-commander-wt/${safe}`;
  if (!existsSync(path)) git(repo, ['worktree', 'add', '-b', `mission/${safe}`, path]);
  return path;
}

export async function seedDemoCases(store: Store): Promise<string[]> {
  const created: string[] = [];

  // ---- Clean up any previous demo missions (by name prefix) ----
  for (const m of store.listMissions()) {
    if (m.name.startsWith('Demo:')) store.deleteMission(m.id);
  }

  const proj1 = store.getProjectByPath(REPO1);
  const proj2 = store.getProjectByPath(REPO2);
  if (!proj1 || !proj2) {
    throw new Error('Test repos not registered. Run seed.ts first.');
  }

  // ============ CASE 1: Branch strategy + PR ============
  {
    const branch = 'feature/demo-branch';
    ensureBranch(REPO1, branch);
    const mission = store.createMission({
      project_id: proj1.id,
      name: 'Demo: branch + PR',
      objective: 'Add a feature on a dedicated branch and open a PR.',
      git_strategy: 'branch',
      base_branch: 'main',
      worktree_path: null,
      driver_type: 'hermes',
      driver_profile: null,
      driver_model: 'deepseek-v4-flash:cloud',
      driver_provider: null,
      driver_worktree_flag: 0,
      uses_kanban: 1,
      intervention: 'autonomous',
      depends_on_mission_ids: '[]',
      max_concurrent: null,
      state: 'done',
      session_id: null,
      started_at: Date.now() - 3600_000,
      finished_at: Date.now() - 3000_000,
    });
    const task = store.createTask({
      mission_id: mission.id,
      title: 'Implement feature on branch',
      description: 'Create the feature files and commit them on the feature branch.',
      state: 'done',
      parent_id: null,
      depends_on: '[]',
      agent_type: 'hermes',
      agent_llm: 'deepseek-v4-flash:cloud',
      agent_system_prompt: null,
      sort_order: 0,
      run_state: 'done',
      git_strategy: 'branch',
      branch,
      worktree_path: null,
    });
    // Executed run + logs
    const run = store.createAgentRun({
      mission_id: mission.id, task_id: task.id, agent_type: 'hermes',
      role: 'subagent', llm: 'deepseek-v4-flash:cloud', state: 'done',
      finished_at: Date.now() - 3000_000, exit_code: 0, session_id: 'demo-branch-session',
    });
    store.addLog(run.id, 'info', 'Spawning task subagent: hermes chat -p default -m deepseek-v4-flash:cloud --in /Users/anibal/Projects/ani-test-1', 'system');
    store.addLog(run.id, 'info', 'Created src/feature.ts with the new module.', 'stdout');
    store.addLog(run.id, 'info', 'Committed changes on feature/demo-branch.', 'stdout');
    store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { before: { state: 'todo', run_state: 'idle' }, after: { state: 'doing', run_state: 'running', title: task.title } } });
    store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { before: { state: 'doing', run_state: 'running' }, after: { state: 'done', run_state: 'done', title: task.title } } });
    created.push('Demo: branch + PR');
  }

  // ============ CASE 2: Worktree strategy ============
  {
    const wt = ensureWorktree(REPO1, 'demo-worktree');
    const mission = store.createMission({
      project_id: proj1.id,
      name: 'Demo: worktree',
      objective: 'Work in an isolated worktree so the main checkout stays clean.',
      git_strategy: 'worktree',
      base_branch: 'main',
      worktree_path: wt,
      driver_type: 'hermes',
      driver_profile: null,
      driver_model: 'deepseek-v4-flash:cloud',
      driver_provider: null,
      driver_worktree_flag: 1,
      uses_kanban: 1,
      intervention: 'autonomous',
      depends_on_mission_ids: '[]',
      max_concurrent: null,
      state: 'running',
      session_id: 'demo-wt-session',
      started_at: Date.now() - 1200_000,
      finished_at: null,
    });
    const task = store.createTask({
      mission_id: mission.id,
      title: 'Build feature in worktree',
      description: 'Implement the feature inside the isolated worktree.',
      state: 'blocked',
      parent_id: null,
      depends_on: '[]',
      agent_type: 'hermes',
      agent_llm: 'deepseek-v4-flash:cloud',
      agent_system_prompt: null,
      sort_order: 0,
      run_state: 'failed',
      git_strategy: 'worktree',
      branch: null,
      worktree_path: wt,
    });
    const run = store.createAgentRun({
      mission_id: mission.id, task_id: task.id, agent_type: 'hermes',
      role: 'subagent', llm: 'deepseek-v4-flash:cloud', state: 'failed',
      finished_at: Date.now() - 600_000, exit_code: 1, session_id: 'demo-wt-session',
    });
    store.addLog(run.id, 'info', `Spawning task subagent in worktree: ${wt}`, 'system');
    store.addLog(run.id, 'info', 'Planning the implementation...', 'stdout');
    store.addLog(run.id, 'error', 'Build failed: cannot resolve module ./feature in worktree checkout.', 'stderr');
    store.addLog(run.id, 'error', 'Exit code 1 — the worktree branch is missing the base commit.', 'stderr');
    store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { before: { state: 'todo', run_state: 'idle' }, after: { state: 'doing', run_state: 'running', title: task.title } } });
    store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { before: { state: 'doing', run_state: 'running' }, after: { state: 'blocked', run_state: 'failed', title: task.title } } });
    created.push('Demo: worktree');
  }

  // ============ CASE 3: Runs / history (multiple tasks) ============
  {
    const mission = store.createMission({
      project_id: proj2.id,
      name: 'Demo: runs & history',
      objective: 'Exercise the history panel with several completed and failed runs.',
      git_strategy: 'none',
      base_branch: null,
      worktree_path: null,
      driver_type: 'hermes',
      driver_profile: null,
      driver_model: 'deepseek-v4-flash:cloud',
      driver_provider: null,
      driver_worktree_flag: 0,
      uses_kanban: 1,
      intervention: 'autonomous',
      depends_on_mission_ids: '[]',
      max_concurrent: null,
      state: 'done',
      session_id: null,
      started_at: Date.now() - 7200_000,
      finished_at: Date.now() - 1000_000,
    });

    const mkTask = (title: string, state: 'done' | 'blocked', runState: 'done' | 'failed', sort: number) => {
      const task = store.createTask({
        mission_id: mission.id, title, description: null, state,
        parent_id: null, depends_on: '[]', agent_type: 'hermes',
        agent_llm: 'deepseek-v4-flash:cloud', agent_system_prompt: null, sort_order: sort,
        run_state: runState, git_strategy: 'none', branch: null, worktree_path: null,
      });
      const run = store.createAgentRun({
        mission_id: mission.id, task_id: task.id, agent_type: 'hermes',
        role: 'subagent', llm: 'deepseek-v4-flash:cloud', state: runState,
        finished_at: Date.now() - 1000_000, exit_code: runState === 'done' ? 0 : 1,
        session_id: `demo-run-${sort}`,
      });
      store.addLog(run.id, 'info', `Spawning task subagent: ${title}`, 'system');
      store.addLog(run.id, runState === 'done' ? 'info' : 'error', runState === 'done' ? 'Task completed successfully.' : 'Task failed: build error in module.', runState === 'done' ? 'stdout' : 'stderr');
      store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { before: { state: 'todo', run_state: 'idle' }, after: { state: 'doing', run_state: 'running', title: task.title } } });
      store.addEvent({ missionId: mission.id, taskId: task.id, type: 'task_status', payload: { before: { state: 'doing', run_state: 'running' }, after: { state, run_state: runState, title: task.title } } });
      return task;
    };

    mkTask('Setup project scaffolding', 'done', 'done', 0);
    mkTask('Implement calculator module', 'done', 'done', 1);
    mkTask('Write unit tests', 'done', 'done', 2);
    mkTask('Fix flaky integration test', 'blocked', 'failed', 3);
    created.push('Demo: runs & history');
  }

  return created;
}

// Run directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('demo-seed.ts')) {
  const dbPath = process.env.HERMES_COMMANDER_DB ?? 'data/hermes-commander.db';
  const store = new Store(dbPath);
  const created = await seedDemoCases(store);
  console.log(`Seeded demo cases: ${created.join(', ') || 'none'}`);
}
