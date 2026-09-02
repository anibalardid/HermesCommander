import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../db/store.js';
import { EventHub } from './ws.js';
import { MissionRunner } from './runner.js';

let store: Store;
let dbDir: string;
let projectId: string;
let runner: MissionRunner;

// Minimal FastifyInstance mock for EventHub.
const fakeApp = { get: () => {} } as never;

beforeAll(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'hermes-commander-deps-'));
  store = new Store(join(dbDir, 'test.db'));
  const project = store.createProject({
    name: 'Deps', path: '/tmp', type: 'folder', remote_url: null,
    created_by: 'open', badge_color: null, parent_group: null,
  });
  projectId = project.id;
  const hub = new EventHub(fakeApp);
  runner = new MissionRunner(store, hub);
});

afterAll(() => {
  rmSync(dbDir, { recursive: true, force: true });
});

function makeMission(name: string, deps: string[] = []) {
  return store.createMission({
    project_id: projectId, name, objective: `objective of ${name}`, git_strategy: 'none',
    base_branch: null, worktree_path: null, driver_type: 'hermes',
    driver_profile: null, driver_model: 'm', driver_provider: null,
    driver_worktree_flag: 0, uses_kanban: 1, intervention: 'autonomous',
    depends_on_mission_ids: JSON.stringify(deps), max_concurrent: null, state: 'pending',
    session_id: null, started_at: null, finished_at: null,
  });
}

describe('mission dependencies', () => {
  it('injects dependent mission context into the objective', () => {
    const dep = makeMission('Setup');
    const m = makeMission('Build', [dep.id]);
    const objective = runner.buildObjective(m);
    expect(objective).toContain('objective of Setup');
    expect(objective).toContain('Context from dependent missions');
  });

  it('injects kanban sync instructions when uses_kanban is set', () => {
    const m = makeMission('KanbanMission');
    // makeMission defaults uses_kanban to 1.
    const objective = runner.buildObjective(m);
    expect(objective).toContain('/tasks/sync');
    expect(objective).toContain('orchestrator');
  });

  it('reports deps as unsatisfied when a dependency is not done', () => {
    const dep = makeMission('Setup2');
    const m = makeMission('Build2', [dep.id]);
    const result = runner.depsSatisfied(m);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Setup2');
  });

  it('reports deps as satisfied when all dependencies are done', () => {
    const dep = makeMission('Setup3');
    store.updateMission(dep.id, { state: 'done' });
    const m = makeMission('Build3', [dep.id]);
    const result = runner.depsSatisfied(m);
    expect(result.ok).toBe(true);
  });

  it('has no deps when the list is empty', () => {
    const m = makeMission('Solo');
    expect(runner.depsSatisfied(m).ok).toBe(true);
  });
});
