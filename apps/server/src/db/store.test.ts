import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import { now } from './schema.js';

let store: Store;
let dbDir: string;
let projectId: string;

beforeAll(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'hermes-commander-store-'));
  store = new Store(join(dbDir, 'test.db'));
  const project = store.createProject({
    name: 'CapTest', path: '/tmp', type: 'folder', remote_url: null,
    created_by: 'open', badge_color: null, parent_group: null,
  });
  projectId = project.id;
});

afterAll(() => {
  rmSync(dbDir, { recursive: true, force: true });
});

function makeMission(name: string, maxConcurrent: number | null) {
  return store.createMission({
    project_id: projectId, name, objective: 'x', git_strategy: 'none',
    base_branch: null, worktree_path: null, driver_type: 'hermes',
    driver_profile: null, driver_model: 'm', driver_provider: null,
    driver_worktree_flag: 0, uses_kanban: 1, intervention: 'autonomous',
    depends_on_mission_ids: '[]', max_concurrent: maxConcurrent, state: 'pending',
    session_id: null, started_at: null, finished_at: null,
  });
}

describe('concurrency cap', () => {
  it('counts running missions per project', () => {
    const m1 = makeMission('m1', null);
    const m2 = makeMission('m2', null);
    expect(store.countRunningMissions(projectId)).toBe(0);

    store.updateMission(m1.id, { state: 'running' });
    expect(store.countRunningMissions(projectId)).toBe(1);

    store.updateMission(m2.id, { state: 'paused' });
    expect(store.countRunningMissions(projectId)).toBe(2);

    store.updateMission(m1.id, { state: 'done' });
    expect(store.countRunningMissions(projectId)).toBe(1);
  });

  it('respects a custom max_concurrent per mission', () => {
    const m = makeMission('m3', 2);
    expect(m.max_concurrent).toBe(2);
  });
});

describe('notifications', () => {
  it('adds, lists, and counts unread notifications', () => {
    const n = store.addNotification({ type: 'task_done', title: 'Done', body: 'Task finished' });
    expect(n.id).toBeTruthy();
    expect(n.read).toBe(0);
    expect(n.title).toBe('Done');
    expect(n.body).toBe('Task finished');

    const list = store.listNotifications();
    expect(list.some((x) => x.id === n.id)).toBe(true);
    expect(store.countUnread()).toBeGreaterThanOrEqual(1);
  });

  it('lists notifications newest first', () => {
    store.addNotification({ type: 'a', title: 'First', body: 'a' });
    store.addNotification({ type: 'b', title: 'Second', body: 'b' });
    const list = store.listNotifications();
    expect(list.length).toBeGreaterThanOrEqual(2);
    // created_at must be non-increasing (newest first).
    for (let i = 1; i < list.length; i++) {
      expect(list[i].created_at).toBeLessThanOrEqual(list[i - 1].created_at);
    }
  });

  it('truncates overlong title/body to cap row size', () => {
    const n = store.addNotification({
      type: 'task_done',
      title: 'x'.repeat(500),
      body: 'y'.repeat(5000),
    });
    expect(n.title.length).toBeLessThanOrEqual(200);
    expect(n.body.length).toBeLessThanOrEqual(2000);
  });

  it('marks a single notification read and read-all', () => {
    const a = store.addNotification({ type: 'a', title: 'A', body: 'a' });
    const b = store.addNotification({ type: 'b', title: 'B', body: 'b' });
    store.markNotificationRead(a.id);
    expect(store.getNotification(a.id)!.read).toBe(1);
    expect(store.getNotification(b.id)!.read).toBe(0);

    store.markAllNotificationsRead();
    expect(store.getNotification(a.id)!.read).toBe(1);
    expect(store.getNotification(b.id)!.read).toBe(1);
    expect(store.countUnread()).toBe(0);
  });

  it('deletes a notification and returns undefined for unknown ids', () => {
    const n = store.addNotification({ type: 'a', title: 'A', body: 'a' });
    store.deleteNotification(n.id);
    expect(store.getNotification(n.id)).toBeUndefined();
    expect(store.getNotification('does-not-exist')).toBeUndefined();
  });

  it('prunes notifications older than the retention window (idempotent)', () => {
    const fresh = store.addNotification({ type: 'a', title: 'Fresh', body: 'a' });
    // Insert an old notification directly with a stale created_at.
    const oldId = store.addNotification({ type: 'a', title: 'Old', body: 'a' }).id;
    // Rewrite its created_at to be far in the past.
    const db = (store as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db;
    db.prepare('UPDATE notifications SET created_at = ? WHERE id = ?').run(now() - 100 * 24 * 60 * 60 * 1000, oldId);

    const pruned = store.pruneNotifications();
    expect(pruned).toBeGreaterThanOrEqual(1);
    expect(store.getNotification(oldId)).toBeUndefined();
    expect(store.getNotification(fresh.id)).toBeDefined();

    // Idempotent: a second prune removes nothing new.
    const prunedAgain = store.pruneNotifications();
    expect(prunedAgain).toBe(0);
  });
});

describe('settings', () => {
  it('returns null for an unset key and persists a value', () => {
    expect(store.getSetting('notifications.sound')).toBeNull();
    store.setSetting('notifications.sound', 'true');
    expect(store.getSetting('notifications.sound')).toBe('true');
  });

  it('upserts an existing key', () => {
    store.setSetting('notifications.sound', 'true');
    store.setSetting('notifications.sound', 'false');
    expect(store.getSetting('notifications.sound')).toBe('false');
  });
});
