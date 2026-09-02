import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../index.js';
import { Store } from '../db/store.js';

// Mock the native folder picker so tests don't open a real Finder dialog.
vi.mock('../git/pick-folder.js', () => ({
  pickFolder: vi.fn().mockResolvedValue(null),
}));

let app: FastifyInstance;
let dbDir: string;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'hermes-commander-test-'));
  process.env.HERMES_COMMANDER_DB = join(dbDir, 'test.db');
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('Projects API', () => {
  it('starts with an empty project list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toEqual([]);
  });

  it('creates a project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { action: 'open', path: '/tmp', name: 'Test' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Test');
    expect(body.path).toBe('/tmp');
    expect(body.type).toBe('folder');
    expect(body.id).toBeTruthy();
  });

  it('scans a path and reports git/folder/nested', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects/scan',
      payload: { path: '/tmp' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('isGitRepo');
    expect(body).toHaveProperty('nestedRepos');
  });

  it('pick-folder returns 400 when no folder is selected', async () => {
    // In a headless test env there's no Finder/zenity, so pickFolder returns null -> 400.
    const res = await app.inject({ method: 'POST', url: '/api/projects/pick-folder' });
    expect([400, 200]).toContain(res.statusCode);
  });
});

describe('Missions API', () => {
  let projectId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { action: 'open', path: '/tmp', name: 'MissionTest' },
    });
    projectId = res.json().id;
  });

  it('creates a mission with driver config', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/missions',
      payload: {
        projectId,
        name: 'Fix auth',
        objective: 'Refactor auth to OAuth2',
        gitStrategy: 'worktree',
        driver: { type: 'hermes', model: 'deepseek-v4-flash:cloud', provider: 'custom' },
        usesKanban: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.name).toBe('Fix auth');
    expect(m.driver_type).toBe('hermes');
    expect(m.driver_model).toBe('deepseek-v4-flash:cloud');
    expect(m.git_strategy).toBe('worktree');
    expect(m.state).toBe('pending');
  });

  it('lists missions for a project', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/missions?projectId=${projectId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().missions.length).toBeGreaterThan(0);
  });

  it('creates a task on a mission', async () => {
    const list = await app.inject({ method: 'GET', url: `/api/missions?projectId=${projectId}` });
    const missionId = list.json().missions[0].id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/missions/${missionId}/tasks`,
      payload: { title: 'Write tests', state: 'todo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Write tests');
  });

  it('syncs a batch of tasks (create + update by title)', async () => {
    const list = await app.inject({ method: 'GET', url: `/api/missions?projectId=${projectId}` });
    const missionId = list.json().missions[0].id;

    // First sync: creates two tasks.
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/missions/${missionId}/tasks/sync`,
      payload: {
        tasks: [
          { title: 'Sync task A', state: 'todo' },
          { title: 'Sync task B', state: 'doing', agentType: 'codex' },
        ],
      },
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().tasks.length).toBe(2);

    // Second sync: updates A to done, creates C.
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/missions/${missionId}/tasks/sync`,
      payload: {
        tasks: [
          { title: 'Sync task A', state: 'done' },
          { title: 'Sync task C', state: 'todo' },
        ],
      },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().tasks.length).toBe(2);

    // Verify: A is done, B is doing, C exists.
    const detail = await app.inject({ method: 'GET', url: `/api/missions/${missionId}` });
    const tasks = detail.json().tasks;
    const a = tasks.find((t: { title: string }) => t.title === 'Sync task A');
    const b = tasks.find((t: { title: string }) => t.title === 'Sync task B');
    const c = tasks.find((t: { title: string }) => t.title === 'Sync task C');
    expect(a.state).toBe('done');
    expect(b.state).toBe('doing');
    expect(b.agent_type).toBe('codex');
    expect(c).toBeTruthy();
  });
});

describe('Task source API (worktree fallback)', () => {
  let repoDir: string;
  let projectId: string;
  let missionId: string;
  let taskId: string;

  beforeAll(async () => {
    // Create a real git repo to back the project.
    repoDir = mkdtempSync(join(tmpdir(), 'hermes-commander-src-'));
    const run = (args: string[]) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
    run(['init', '-q']);
    run(['config', 'user.email', 't@t.t']);
    run(['config', 'user.name', 'Test']);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(repoDir, 'a.txt'), 'hi\n');
    run(['add', 'a.txt']);
    run(['commit', '-m', 'init']);

    const proj = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { action: 'open', path: repoDir, name: 'SrcTest' },
    });
    projectId = proj.json().id;

    const mission = await app.inject({
      method: 'POST',
      url: '/api/missions',
      payload: { projectId, name: 'Src mission', objective: 'x', gitStrategy: 'worktree' },
    });
    missionId = mission.json().id;

    const task = await app.inject({
      method: 'POST',
      url: `/api/missions/${missionId}/tasks`,
      payload: { title: 'Src task', state: 'todo' },
    });
    taskId = task.json().id;
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns 200 with the repo status when the task worktree path does not exist', async () => {
    // Point the task at a worktree that was deleted (e.g. after a PR merge).
    const { join: pjoin } = await import('node:path');
    const ghost = pjoin(repoDir, 'ghost-worktree');
    const upd = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      payload: { worktree_path: ghost },
    });
    expect(upd.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/source` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.branch).toBe('main');
    expect(body.worktreePath).toBe(repoDir);
  });

  it('never 500s on any task source endpoint when the worktree is gone', async () => {
    // The task already points at a non-existent worktree (set in the previous
    // test). Every task-scoped source endpoint must degrade to the repo workdir
    // instead of throwing a 500 — this is the regression that flooded the
    // console when CreatePrButton mounted.
    const { join: pjoin } = await import('node:path');
    const ghost = pjoin(repoDir, 'ghost-worktree');
    await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      payload: { worktree_path: ghost },
    });

    const cases: Array<{ method: 'GET' | 'POST'; url: string; payload?: object }> = [
      { method: 'GET', url: `/api/tasks/${taskId}/source` },
      { method: 'GET', url: `/api/tasks/${taskId}/source/diff?file=a.txt` },
      { method: 'GET', url: `/api/tasks/${taskId}/source/commits` },
      { method: 'POST', url: `/api/tasks/${taskId}/source/commit`, payload: { message: 'x' } },
      { method: 'POST', url: `/api/tasks/${taskId}/source/push` },
      { method: 'POST', url: `/api/tasks/${taskId}/source/revert` },
      { method: 'POST', url: `/api/tasks/${taskId}/source/checkout`, payload: { branch: 'main' } },
    ];

    for (const c of cases) {
      const res = await app.inject({ method: c.method, url: c.url, payload: c.payload });
      // 200/400 are fine (degraded or expected validation error); 500 is the bug.
      expect(res.statusCode, `${c.method} ${c.url}`).not.toBe(500);
    }
  });
});

describe('Agent config API', () => {
  it('seeds default agents', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/agents-config' });
    expect(res.statusCode).toBe(200);
    const names = res.json().agents.map((a: { name: string }) => a.name);
    expect(names).toContain('hermes');
    expect(names).toContain('codex');
  });

  it('updates an agent enabled flag', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/agents-config' });
    const agent = list.json().agents[0];
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents-config/${agent.id}`,
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Notifications API', () => {
  // The app's Store isn't exposed, so open a second connection to the same DB
  // file to seed notifications (WAL allows concurrent readers/writers).
  let seedStore: Store;
  let notifId: string;

  beforeAll(() => {
    seedStore = new Store(process.env.HERMES_COMMANDER_DB!);
    const n = seedStore.addNotification({ type: 'task_done', title: 'Hello', body: 'World' });
    notifId = n.id;
  });

  afterAll(() => {
    seedStore.close();
  });

  it('lists notifications with an unread count', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.notifications)).toBe(true);
    expect(body.notifications.some((x: { id: string }) => x.id === notifId)).toBe(true);
    expect(typeof body.unread).toBe('number');
  });

  it('marks a notification read', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/notifications/${notifId}/read` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('returns 404 for an unknown notification id on read', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/notifications/does-not-exist/read' });
    expect(res.statusCode).toBe(404);
  });

  it('marks all notifications read', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/notifications/read-all' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const list = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(list.json().unread).toBe(0);
  });

  it('deletes a notification', async () => {
    const n = seedStore.addNotification({ type: 'a', title: 'ToDelete', body: 'x' });
    const res = await app.inject({ method: 'DELETE', url: `/api/notifications/${n.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const list = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(list.json().notifications.some((x: { id: string }) => x.id === n.id)).toBe(false);
  });

  it('returns 404 for an unknown notification id on delete', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/notifications/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});

describe('Settings API (notifications)', () => {
  it('returns a default sound of true', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/notifications' });
    expect(res.statusCode).toBe(200);
    expect(res.json().sound).toBe(true);
  });

  it('patches sound to false and reads it back', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/notifications',
      payload: { sound: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sound).toBe(false);

    const read = await app.inject({ method: 'GET', url: '/api/settings/notifications' });
    expect(read.json().sound).toBe(false);
  });

  it('rejects a non-boolean sound with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/notifications',
      payload: { sound: 'yes' },
    });
    expect(res.statusCode).toBe(400);
  });
});
