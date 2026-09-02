import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../db/store.js';
import { EventHub } from './ws.js';
import { MissionRunner } from './runner.js';

// Mock child_process.spawn so runSubtask doesn't actually launch `hermes`.
// Emits a fake stdout line with a session_id and closes with code 0.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      // Emit a session_id so the run is considered a real completion.
      setImmediate(() => {
        proc.stdout.emit('data', 'session_id: test-session-123\n');
        proc.emit('close', 0);
      });
      return proc;
    }),
  };
});

let store: Store;
let dbDir: string;
let projectId: string;
let runner: MissionRunner;

const fakeApp = { get: () => {} } as never;

beforeAll(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'hermes-commander-taskrun-'));
  store = new Store(join(dbDir, 'test.db'));
  const project = store.createProject({
    name: 'TaskRun', path: '/tmp', type: 'folder', remote_url: null,
    created_by: 'open', badge_color: null, parent_group: null,
  });
  projectId = project.id;
  const hub = new EventHub(fakeApp);
  runner = new MissionRunner(store, hub);
});

afterAll(() => {
  rmSync(dbDir, { recursive: true, force: true });
});

function makeMission(name: string) {
  return store.createMission({
    project_id: projectId, name, objective: `objective of ${name}`, git_strategy: 'none',
    base_branch: null, worktree_path: null, driver_type: 'hermes',
    driver_profile: null, driver_model: 'm', driver_provider: null,
    driver_worktree_flag: 0, uses_kanban: 1, intervention: 'autonomous',
    depends_on_mission_ids: '[]', max_concurrent: null, state: 'pending',
    session_id: null, started_at: null, finished_at: null,
  });
}

describe('task execution (runTask)', () => {
  it('rejects a task that does not exist', async () => {
    const result = await runner.runTask('nonexistent-task');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('task not found');
  });

  it('marks a subtask as doing and creates a subagent run', async () => {
    const m = makeMission('TaskMission');
    // A leaf subtask (has a parent) runs directly as a subagent.
    const parent = store.createTask({
      mission_id: m.id, title: 'Orchestrator', description: 'parent',
      state: 'todo', parent_id: null, depends_on: '[]', agent_type: 'hermes',
      agent_llm: null, agent_system_prompt: null, sort_order: 0,
    });
    const task = store.createTask({
      mission_id: m.id, title: 'Write tests', description: 'Add unit tests',
      state: 'todo', parent_id: parent.id, depends_on: '[]', agent_type: 'codex',
      agent_llm: null, agent_system_prompt: null, sort_order: 0,
    });

    // runTask spawns a mocked hermes that completes successfully (exit 0 +
    // session_id), so the subtask should end up done with a subagent run.
    const result = await runner.runTask(task.id);
    expect(result.ok).toBe(true);
    const updated = store.getTask(task.id);
    expect(updated?.state).toBe('done');
    expect(updated?.run_state).toBe('done');
    const runs = store.listRunsForTask(task.id);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].role).toBe('subagent');
    expect(runs[0].task_id).toBe(task.id);
    expect(runs[0].state).toBe('done');
  });

  it('orchestrator (parent task) plans and delegates subtasks, then marks done', async () => {
    const m = makeMission('OrchMission');
    const parent = store.createTask({
      mission_id: m.id, title: 'Orchestrator', description: 'parent',
      state: 'todo', parent_id: null, depends_on: '[]', agent_type: 'hermes',
      agent_llm: null, agent_system_prompt: null, sort_order: 0,
    });

    // Mock the planner to return a single subtask so the orchestrator has
    // something to delegate.
    const planner = await import('./planner.js');
    const spy = vi.spyOn(planner, 'runPlanner').mockResolvedValue({
      ok: true,
      subtasks: [{ title: 'Subtask A', description: 'do it', agentType: 'frontend' }],
    });

    try {
      const result = await runner.runTask(parent.id);
      // Orchestrator runs in background — returns ok immediately.
      expect(result.ok).toBe(true);

      // Wait for the background orchestrator to finish (it delegates the
      // mocked subtask, which completes via the mocked spawn).
      await new Promise((r) => setTimeout(r, 50));

      const children = store.listTasks(m.id).filter((t) => t.parent_id === parent.id);
      expect(children.length).toBe(1);
      expect(children[0].title).toBe('Subtask A');
      expect(children[0].state).toBe('done');

      const updated = store.getTask(parent.id);
      expect(updated?.state).toBe('done');
      expect(updated?.run_state).toBe('done');
    } finally {
      spy.mockRestore();
    }
  });

  it('planTaskAsync persists planning state and creates subtasks in background', async () => {
    const m = makeMission('AsyncPlan');
    const parent = store.createTask({
      mission_id: m.id, title: 'Async Parent', description: 'parent',
      state: 'todo', parent_id: null, depends_on: '[]', agent_type: 'hermes',
      agent_llm: null, agent_system_prompt: null, sort_order: 0,
      subagent_ids: '["frontend"]',
    });

    const planner = await import('./planner.js');
    const spy = vi.spyOn(planner, 'runPlanner').mockResolvedValue({
      ok: true,
      subtasks: [{ title: 'Async Subtask', description: 'do it', agentType: 'frontend' }],
    });

    try {
      // planTaskAsync must return immediately (fire-and-forget).
      const result = await runner.planTaskAsync(parent.id);
      expect(result.ok).toBe(true);

      // Immediately after the call, the task must be marked 'planning' so a
      // page refresh keeps showing the spinner.
      expect(store.getTask(parent.id)?.run_state).toBe('planning');

      // Wait for the background planner to finish and materialize subtasks.
      await new Promise((r) => setTimeout(r, 50));
      const children = store.listTasks(m.id).filter((t) => t.parent_id === parent.id);
      expect(children.length).toBe(1);
      expect(children[0].title).toBe('Async Subtask');
      // The parent returns to idle once planning completes.
      expect(store.getTask(parent.id)?.run_state).toBe('idle');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('watchdog', () => {
  it('auto-retries a delegating orchestrator stuck with no active subtask', async () => {
    const m = makeMission('WatchdogMission');
    const parent = store.createTask({
      mission_id: m.id, title: 'Stuck Orch', description: 'parent',
      state: 'doing', parent_id: null, depends_on: '[]', agent_type: 'hermes',
      agent_llm: null, agent_system_prompt: null, sort_order: 0,
    });
    // Simulate a crashed orchestrator: it's delegating, one subtask done,
    // another pending (todo) with satisfied deps, but NO subtask is running.
    const done = store.createTask({
      mission_id: m.id, title: 'Done subtask', description: 'x',
      state: 'done', parent_id: parent.id, depends_on: '[]', agent_type: 'codex',
      agent_llm: null, agent_system_prompt: null, sort_order: 0,
    });
    const pending = store.createTask({
      mission_id: m.id, title: 'Pending subtask', description: 'y',
      state: 'todo', parent_id: parent.id, depends_on: `["${done.id}"]`, agent_type: 'codex',
      agent_llm: null, agent_system_prompt: null, sort_order: 1,
    });
    // Mark the orchestrator delegating with no live process (taskProcesses empty).
    store.updateTask(parent.id, { run_state: 'delegating' });

    const res = await runner.watchdog();
    // The stuck orchestrator should be recovered (auto-retried).
    expect(res.tasksRecovered).toBeGreaterThanOrEqual(1);
    // It should have been re-run: retry_count incremented (the orchestrator
    // is relaunched, so it goes back to delegating — that's the self-heal).
    const updated = store.getTask(parent.id);
    expect((updated?.retry_count ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
