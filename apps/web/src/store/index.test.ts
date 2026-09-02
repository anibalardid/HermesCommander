import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from './index';
import type { Notification } from '../lib/types';

// Mock the api module so store actions don't hit the network.
vi.mock('../lib/api', () => ({
  api: {
    listNotifications: vi.fn(async () => ({ notifications: [], unread: 0 })),
    markNotificationRead: vi.fn(async () => ({ ok: true })),
    markAllNotificationsRead: vi.fn(async () => ({ ok: true })),
    deleteNotification: vi.fn(async () => ({ ok: true })),
  },
  wsUrl: () => 'ws://localhost/ws',
}));

// Mock the sound helper (WebAudio is unavailable in jsdom).
vi.mock('../lib/sound', () => ({
  playNotificationSound: vi.fn(),
}));

const n = (id: string, read = 0): Notification => ({
  id,
  type: 'test',
  title: `Title ${id}`,
  body: `Body ${id}`,
  read,
  link: null,
  created_at: Date.now(),
});

describe('notifications store slice', () => {
  beforeEach(() => {
    // Reset the slice to a known state.
    useStore.setState({ notifications: [], unread: 0 });
  });

  it('markRead flips a notification to read and decrements unread', async () => {
    useStore.setState({ notifications: [n('a', 0), n('b', 0)], unread: 2 });

    await useStore.getState().markRead('a');

    const s = useStore.getState();
    expect(s.notifications.find((x) => x.id === 'a')?.read).toBe(1);
    expect(s.notifications.find((x) => x.id === 'b')?.read).toBe(0);
    expect(s.unread).toBe(1);
  });

  it('markRead does not decrement unread below zero for an already-read item', async () => {
    useStore.setState({ notifications: [n('a', 1)], unread: 0 });

    await useStore.getState().markRead('a');

    expect(useStore.getState().unread).toBe(0);
  });

  it('markAllRead clears the badge and marks every notification read', async () => {
    useStore.setState({ notifications: [n('a', 0), n('b', 0), n('c', 1)], unread: 2 });

    await useStore.getState().markAllRead();

    const s = useStore.getState();
    expect(s.unread).toBe(0);
    expect(s.notifications.every((x) => x.read === 1)).toBe(true);
  });

  it('remove deletes a notification and adjusts unread when it was unread', async () => {
    useStore.setState({ notifications: [n('a', 0), n('b', 1)], unread: 1 });

    await useStore.getState().remove('a');

    const s = useStore.getState();
    expect(s.notifications.map((x) => x.id)).toEqual(['b']);
    expect(s.unread).toBe(0);
  });

  it('remove does not change unread when the removed item was already read', async () => {
    useStore.setState({ notifications: [n('a', 1), n('b', 0)], unread: 1 });

    await useStore.getState().remove('a');

    const s = useStore.getState();
    expect(s.notifications.map((x) => x.id)).toEqual(['b']);
    expect(s.unread).toBe(1);
  });
});
