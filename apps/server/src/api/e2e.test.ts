import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../index.js';

let app: FastifyInstance;
let dbDir: string;

beforeAll(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'hermes-commander-e2e-'));
  process.env.HERMES_COMMANDER_DB = join(dbDir, 'e2e.db');
  process.env.NODE_ENV = 'test';
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(dbDir, { recursive: true, force: true });
});

describe('End-to-end flow', () => {
  it('creates a project, a mission, and a task, then lists them', async () => {
    // 1. Create project
    const proj = await app.inject({
      method: 'POST', url: '/api/projects',
      payload: { action: 'open', path: '/tmp', name: 'E2E' },
    });
    const project = proj.json();
    expect(project.id).toBeTruthy();

    // 2. Create mission
    const mis = await app.inject({
      method: 'POST', url: '/api/missions',
      payload: {
        projectId: project.id, name: 'E2E mission', objective: 'Do the thing',
        gitStrategy: 'none', driver: { type: 'hermes', model: 'm' },
      },
    });
    const mission = mis.json();
    expect(mission.id).toBeTruthy();
    expect(mission.state).toBe('pending');

    // 3. Create task
    const task = await app.inject({
      method: 'POST', url: `/api/missions/${mission.id}/tasks`,
      payload: { title: 'Step 1', state: 'todo' },
    });
    expect(task.json().title).toBe('Step 1');

    // 4. List mission detail
    const detail = await app.inject({ method: 'GET', url: `/api/missions/${mission.id}` });
    const body = detail.json();
    expect(body.mission.id).toBe(mission.id);
    expect(body.tasks.length).toBe(1);
    expect(body.tasks[0].title).toBe('Step 1');
  });
});
