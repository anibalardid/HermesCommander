import { create } from 'zustand';
import { api, wsUrl } from '../lib/api';
import { playNotificationSound } from '../lib/sound';
import type { Project, Mission, AgentConfig, Notification } from '../lib/types';

type OfficeEvent = {
  scope: 'office' | 'project' | 'mission';
  id: string | null;
  type: string;
  payload: Record<string, unknown>;
  at: number;
};

type HermesCommanderState = {
  projects: Project[];
  missions: Mission[];
  agentsConfig: AgentConfig[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  paletteOpen: boolean;
  theme: 'dark' | 'light' | 'system';
  mobileNavOpen: boolean;
  notifications: Notification[];
  unread: number;
  chatOpen: boolean;
  /** taskId -> whether a live OS process is behind it (from /api/live-status). */
  liveTasks: Record<string, boolean>;
  /** missionId -> whether a live tmux session is behind it. */
  liveMissions: Record<string, boolean>;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  connectWs: () => void;
  startLivePolling: () => void;
  setPaletteOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setChatOpen: (open: boolean) => void;
  subscribeMission: (id: string) => void;
  unsubscribeMission: (id: string) => void;
  onMissionEvent: (id: string, cb: (type: string) => void) => () => void;
  createProject: (body: Record<string, unknown>) => Promise<Project>;
  updateProject: (id: string, body: Record<string, unknown>) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  createMission: (body: Record<string, unknown>) => Promise<Mission>;
  updateMission: (id: string, body: Record<string, unknown>) => Promise<Mission>;
  deleteMission: (id: string) => Promise<void>;
  deleteTask: (id: string, opts?: { removeWorktree?: boolean }) => Promise<void>;
  startMission: (id: string) => Promise<void>;
  pauseMission: (id: string) => Promise<void>;
  resumeMission: (id: string) => Promise<void>;
  stopMission: (id: string) => Promise<void>;
  setLanguage: (lang: string) => void;
  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  loadNotifications: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

// Module-level ws + per-mission event listeners (not persisted in zustand).
let ws: WebSocket | null = null;
const missionListeners = new Map<string, Set<(type: string) => void>>();
const subscribedMissions = new Set<string>();

function notifyMission(id: string, type: string) {
  missionListeners.get(id)?.forEach((cb) => cb(type));
}

export const useStore = create<HermesCommanderState>((set, get) => ({
  projects: [],
  missions: [],
  agentsConfig: [],
  loading: true,
  error: null,
  connected: false,
  paletteOpen: false,
  theme: (localStorage.getItem('hermes-commander.theme') as 'dark' | 'light' | 'system') ?? 'system',
  mobileNavOpen: false,
  notifications: [],
  unread: 0,
  chatOpen: false,
  liveTasks: {},
  liveMissions: {},

  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  setChatOpen: (open) => set({ chatOpen: open }),

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [projects, missions, agents] = await Promise.all([
        api.listProjects(),
        api.listMissions(),
        api.listAgentConfig(),
      ]);
      set({ projects: projects.projects, missions: missions.missions, agentsConfig: agents.agents, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  refresh: () => get().load(),

  connectWs: () => {
    if (ws) return;
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      set({ connected: true });
      ws?.send(JSON.stringify({ type: 'subscribe', channel: 'office' }));
      // Re-subscribe to any missions that were active before a reconnect.
      subscribedMissions.forEach((id) => {
        ws?.send(JSON.stringify({ type: 'subscribe', channel: `mission:${id}` }));
      });
    };
    ws.onclose = () => {
      set({ connected: false });
      ws = null;
    };
    ws.onerror = () => set({ connected: false });
    ws.onmessage = (ev) => {
      try {
        const data: OfficeEvent = JSON.parse(ev.data as string);
        if (data.scope === 'office' && data.type === 'project_created') void get().refresh();
        if (data.type === 'state_change') void get().refresh();
        // Live kanban: forward mission-scoped task events to listeners.
        if (data.scope === 'mission' && data.id) {
          notifyMission(data.id, data.type);
        }
        // Live notification: prepend to the list, bump the unread badge, and
        // play the sound cue (the helper reads the preference and no-ops when
        // disabled or when the browser blocks autoplay).
        if (data.scope === 'office' && data.type === 'notification') {
          const n = (data.payload as { notification?: Notification }).notification;
          if (n) {
            set((s) => ({
              notifications: [n, ...s.notifications.filter((x) => x.id !== n.id)],
              unread: s.unread + 1,
            }));
            playNotificationSound();
            // A task/mission just finished or failed — refresh the store so the
            // list screens (home, project detail) update their mission dots and
            // task counters live, without a page reload.
            if (n.type === 'task_done' || n.type === 'task_failed' ||
                n.type === 'mission_done' || n.type === 'mission_failed') {
              void get().refresh();
            }
          }
        }
      } catch {
        // ignore malformed
      }
    };
  },

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  // Poll /api/live-status every few seconds so the UI can tell a genuinely
  // running task from a stale one (active state but no live OS process).
  startLivePolling: () => {
    const poll = async () => {
      try {
        const s = await api.getLiveStatus();
        const tasks: Record<string, boolean> = {};
        for (const t of s.tasks) tasks[t.taskId] = t.alive;
        const missions: Record<string, boolean> = {};
        for (const m of s.missions) missions[m.missionId] = m.alive;
        set({ liveTasks: tasks, liveMissions: missions });
      } catch {
        // ignore transient polling errors
      }
    };
    void poll();
    const iv = setInterval(poll, 5000);
    // Stop polling when the app unloads.
    window.addEventListener('beforeunload', () => clearInterval(iv));
  },

  subscribeMission: (id) => {
    if (subscribedMissions.has(id)) return;
    subscribedMissions.add(id);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', channel: `mission:${id}` }));
    }
  },

  unsubscribeMission: (id) => {
    subscribedMissions.delete(id);
    missionListeners.delete(id);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', channel: `mission:${id}` }));
    }
  },

  onMissionEvent: (id, cb) => {
    if (!missionListeners.has(id)) missionListeners.set(id, new Set());
    missionListeners.get(id)!.add(cb);
    return () => {
      missionListeners.get(id)?.delete(cb);
    };
  },

  createProject: async (body) => {
    const p = await api.createProject(body);
    await get().refresh();
    return p;
  },
  updateProject: async (id, body) => {
    const p = await api.updateProject(id, body);
    await get().refresh();
    return p;
  },
  deleteProject: async (id) => {
    await api.deleteProject(id);
    await get().refresh();
  },

  createMission: async (body) => {
    const m = await api.createMission(body);
    await get().refresh();
    return m;
  },
  updateMission: async (id, body) => {
    const m = await api.updateMission(id, body);
    await get().refresh();
    return m;
  },
  deleteMission: async (id) => {
    await api.deleteMission(id);
    await get().refresh();
  },
  deleteTask: async (id, opts) => {
    await api.deleteTask(id, opts);
    await get().refresh();
  },

  startMission: async (id) => {
    await api.startMission(id);
    await get().refresh();
  },
  pauseMission: async (id) => {
    await api.pauseMission(id);
    await get().refresh();
  },
  resumeMission: async (id) => {
    await api.resumeMission(id);
    await get().refresh();
  },
  stopMission: async (id) => {
    await api.stopMission(id);
    await get().refresh();
  },

  setLanguage: (lang) => {
    localStorage.setItem('hermes-commander.lang', lang);
    location.reload();
  },
  setTheme: (theme) => {
    const root = document.documentElement;
    const apply = (dark: boolean) => {
      if (dark) root.classList.add('dark');
      else root.classList.remove('dark');
    };
    if (theme === 'system') {
      apply(window.matchMedia('(prefers-color-scheme: dark)').matches);
    } else {
      apply(theme === 'dark');
    }
    localStorage.setItem('hermes-commander.theme', theme);
    set({ theme });
  },

  loadNotifications: async () => {
    try {
      const r = await api.listNotifications();
      set({ notifications: r.notifications, unread: r.unread });
    } catch {
      // Non-fatal: the bell simply stays empty if the fetch fails.
    }
  },

  markAllRead: async () => {
    // Optimistic: clear the badge immediately, then sync with the backend.
    set((s) => ({
      unread: 0,
      notifications: s.notifications.map((n) => ({ ...n, read: 1 })),
    }));
    try {
      await api.markAllNotificationsRead();
    } catch {
      // Ignore — the optimistic state is still correct for this session.
    }
  },

  markRead: async (id) => {
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: 1 } : n)),
      unread: Math.max(0, s.unread - (s.notifications.find((n) => n.id === id && n.read === 0) ? 1 : 0)),
    }));
    try {
      await api.markNotificationRead(id);
    } catch {
      // Ignore.
    }
  },

  remove: async (id) => {
    set((s) => {
      const target = s.notifications.find((n) => n.id === id);
      return {
        notifications: s.notifications.filter((n) => n.id !== id),
        unread: target && target.read === 0 ? Math.max(0, s.unread - 1) : s.unread,
      };
    });
    try {
      await api.deleteNotification(id);
    } catch {
      // Ignore.
    }
  },
}));
