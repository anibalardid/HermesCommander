import type {
  Project, Mission, Task, AgentRun, AgentLogEntry, AgentConfig, MissionDetail,
  SubagentRecipe, SourceStatus, FileEntry, WorktreeInfo, BranchInfo, HermesSession,
  GithubPr, GithubPrDetail, ProblematicTask, CommitInfo, DevPrompt, FsEntry, Notification,
} from './types';

const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Prefer the backend's { error } field for a clean, friendly message.
    let msg = `${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error) msg = String(parsed.error);
    } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Projects
  listProjects: () => req<{ projects: Project[] }>('/projects'),
  search: (q: string) =>
    req<{ projects: Project[]; missions: Mission[]; tasks: Task[] }>(`/search?q=${encodeURIComponent(q)}`),
  listRecipes: () => req<{ recipes: SubagentRecipe[] }>('/recipes'),
  createRecipe: (body: Record<string, unknown>) =>
    req<{ recipe: SubagentRecipe }>('/recipes', { method: 'POST', body: JSON.stringify(body) }),
  updateRecipe: (id: string, body: Record<string, unknown>) =>
    req<{ recipe: SubagentRecipe }>(`/recipes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRecipe: (id: string) => req<{ ok: boolean }>(`/recipes/${id}`, { method: 'DELETE' }),
  // Dev prompt library (proxied through backend, 1h cache)
  searchPrompts: (q?: string) => {
    const qs = q ? `?q=${encodeURIComponent(q)}` : '';
    return req<{ prompts: DevPrompt[]; total: number }>(`/prompts${qs}`);
  },
  // Filesystem browser (mobile-friendly folder picker)
  browseFs: (path?: string) => {
    const qs = path ? `?path=${encodeURIComponent(path)}` : '';
    return req<{ path: string; entries: FsEntry[]; roots: string[] }>(`/fs/browse${qs}`);
  },
  // GitHub owners (user + orgs) for creating repos
  listOwners: () => req<{ user: string | null; orgs: string[] }>('/github/owners'),
  createProject: (body: Record<string, unknown>) =>
    req<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    req<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  scanPath: (path: string) =>
    req<{ path: string; isGitRepo: boolean; isFolder: boolean; nestedRepos: Array<{ name: string; path: string }>; branch: string | null }>(
      '/projects/scan', { method: 'POST', body: JSON.stringify({ path }) }),
  pickFolder: () => req<{ path: string }>('/projects/pick-folder', { method: 'POST', body: '{}' }),
  mkdir: (parent: string, name: string) =>
    req<{ path: string }>('/fs/mkdir', { method: 'POST', body: JSON.stringify({ parent, name }) }),
  deleteProject: (id: string) => req<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  getStats: () => req<{ stats: { total: number; active: number; done: number; failed: number } }>('/stats'),

  // Missions
  listMissions: (projectId?: string) =>
    req<{ missions: Mission[] }>(projectId ? `/missions?projectId=${projectId}` : '/missions'),
  getMission: (id: string) => req<MissionDetail>(`/missions/${id}`),
  listMissionBranches: (id: string) => req<{ branches: Array<{ name: string; current: boolean }> }>(`/missions/${id}/branches`),
  createMission: (body: Record<string, unknown>) => req<Mission>('/missions', { method: 'POST', body: JSON.stringify(body) }),
  updateMission: (id: string, body: Record<string, unknown>) =>
    req<Mission>(`/missions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  startMission: (id: string) => req<{ ok: boolean }>(`/missions/${id}/start`, { method: 'POST' }),
  pauseMission: (id: string) => req<{ ok: boolean }>(`/missions/${id}/pause`, { method: 'POST' }),
  resumeMission: (id: string) => req<{ ok: boolean }>(`/missions/${id}/resume`, { method: 'POST' }),
  stopMission: (id: string) => req<{ ok: boolean }>(`/missions/${id}/stop`, { method: 'POST' }),
  interruptMission: (id: string, message: string) =>
    req<{ ok: boolean }>(`/missions/${id}/interrupt`, { method: 'POST', body: JSON.stringify({ message }) }),
  deleteMission: (id: string) => req<{ ok: boolean }>(`/missions/${id}`, { method: 'DELETE' }),

  // Tasks
  listTasks: (missionId: string) => req<{ tasks: Task[] }>(`/missions/${missionId}/tasks`),
  createTask: (missionId: string, body: Record<string, unknown>) =>
    req<Task>(`/missions/${missionId}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    req<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (id: string, opts?: { removeWorktree?: boolean }) => req<{ ok: boolean }>(`/tasks/${id}${opts?.removeWorktree === false ? '?removeWorktree=false' : ''}`, { method: 'DELETE' }),
  runTask: (id: string) => req<{ ok: boolean }>(`/tasks/${id}/run`, { method: 'POST' }),
  stopTask: (id: string) => req<{ ok: boolean }>(`/tasks/${id}/stop`, { method: 'POST' }),
  planTask: (id: string) => req<{ ok: boolean; subtasks?: Task[] }>(`/tasks/${id}/plan`, { method: 'POST' }),
  createTaskPr: (id: string, title: string, body?: string, base?: string) =>
    req<{ url: string; projectId: string | null; projectName: string | null }>(`/tasks/${id}/pr`, {
      method: 'POST',
      body: JSON.stringify({ title, body: body ?? null, base: base ?? null }),
    }),
  getTaskSource: (id: string) => req<SourceStatus>(`/tasks/${id}/source`),
  taskCommit: (id: string, message: string) =>
    req<{ sha: string }>(`/tasks/${id}/source/commit`, { method: 'POST', body: JSON.stringify({ message }) }),
  taskPush: (id: string) => req<{ ok: boolean }>(`/tasks/${id}/source/push`, { method: 'POST' }),
  taskRevert: (id: string) => req<{ ok: boolean }>(`/tasks/${id}/source/revert`, { method: 'POST' }),
  getTaskDiff: (id: string, file: string) =>
    req<{ diff: string }>(`/tasks/${id}/source/diff?file=${encodeURIComponent(file)}`),
  taskCheckout: (id: string, branch: string) =>
    req<{ ok: boolean; branch: string }>(`/tasks/${id}/source/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch }),
    }),
  taskCommits: (id: string) => req<{ commits: CommitInfo[] }>(`/tasks/${id}/source/commits`),
  syncTasks: (missionId: string, tasks: Array<{ title: string; state?: string; description?: string; agentType?: string }>) =>
    req<{ tasks: Task[] }>(`/missions/${missionId}/tasks/sync`, { method: 'POST', body: JSON.stringify({ tasks }) }),

  // Telemetry
  listRunsForMission: (missionId: string) => req<{ runs: AgentRun[] }>(`/missions/${missionId}/runs`),
  listRunsForTask: (taskId: string) => req<{ runs: AgentRun[] }>(`/tasks/${taskId}/runs`),
  listMissionEvents: (id: string, taskId?: string) =>
    req<{ events: Array<{ id: string; type: string; payload: Record<string, unknown>; created_at: number }> }>(
      `/missions/${id}/events${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`
    ),
  listLogsForRun: (runId: string) => req<{ logs: AgentLogEntry[] }>(`/runs/${runId}/logs`),
  listMissionLogs: (missionId: string) => req<{ logs: AgentLogEntry[] }>(`/missions/${missionId}/logs`),

  // Agent config
  listAgentConfig: () => req<{ agents: AgentConfig[] }>('/agents-config'),
  createAgentConfig: (body: Record<string, unknown>) =>
    req<{ agent: AgentConfig }>('/agents-config', { method: 'POST', body: JSON.stringify(body) }),
  deleteAgentConfig: (id: string) => req<{ ok: boolean }>(`/agents-config/${id}`, { method: 'DELETE' }),
  updateAgentConfig: (id: string, body: Record<string, unknown>) =>
    req<{ ok: boolean }>(`/agents-config/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Hermes query (profiles / providers / models)
  listHermesProfiles: () => req<{ profiles: Array<{ name: string; model: string; provider: string }> }>('/hermes/profiles'),
  listHermesSessions: (profile?: string, source?: string) => {
    const params = new URLSearchParams();
    if (profile) params.set('profile', profile);
    if (source) params.set('source', source);
    return req<{ sessions: HermesSession[] }>(`/hermes/sessions?${params.toString()}`);
  },
  listHermesProviders: () => req<{ providers: string[] }>('/hermes/providers'),
  listHermesModels: (provider: string) => req<{ models: string[] }>(`/hermes/models?provider=${encodeURIComponent(provider)}`),

  // Embedded terminal (TUI): availability probe for python3/helper/hermes.
  terminalStatus: () =>
    req<{ status: { available: boolean; python: boolean; helper: boolean; hermes: boolean } }>('/terminal/status'),
  listHermesSkills: () => req<{ skills: Array<{ category: string; skills: string[] }> }>('/hermes/skills'),
  listHermesMcp: () => req<{ servers: Array<{ name: string; enabled: boolean; command: string }> }>('/hermes/mcp'),
  chatHermes: (message: string, opts: { profile?: string; model?: string; provider?: string; session_id?: string } = {}) =>
    req<{ reply: string; session_id?: string }>('/hermes/chat', {
      method: 'POST',
      body: JSON.stringify({ message, ...opts }),
    }),

  // Workspace panel — source control
  getSourceStatus: (missionId: string) => req<SourceStatus>(`/missions/${missionId}/source`),
  sourceCommit: (missionId: string, message: string) =>
    req<{ sha: string }>(`/missions/${missionId}/source/commit`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  sourcePush: (missionId: string) => req<{ ok: boolean }>(`/missions/${missionId}/source/push`, { method: 'POST' }),
  sourceRevert: (missionId: string) => req<{ ok: boolean }>(`/missions/${missionId}/source/revert`, { method: 'POST' }),
  sourceCreatePr: (missionId: string, title: string, body?: string) =>
    req<{ url: string }>(`/missions/${missionId}/source/pr`, {
      method: 'POST',
      body: JSON.stringify({ title, body: body ?? null }),
    }),
  sourceDiff: (missionId: string, file: string) =>
    req<{ diff: string }>(`/missions/${missionId}/source/diff?file=${encodeURIComponent(file)}`),
  sourceCheckout: (missionId: string, branch: string) =>
    req<{ ok: boolean; branch: string }>(`/missions/${missionId}/source/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch }),
    }),
  sourceCommits: (missionId: string) => req<{ commits: CommitInfo[] }>(`/missions/${missionId}/source/commits`),

  // Workspace panel — file browser
  listFiles: (missionId: string, path = '') =>
    req<{ root: string; entries: FileEntry[] }>(`/missions/${missionId}/files?path=${encodeURIComponent(path)}`),
  readFile: (missionId: string, path: string) =>
    req<{ content: string; truncated: boolean }>(`/missions/${missionId}/files/content?path=${encodeURIComponent(path)}`),
  writeFile: (missionId: string, path: string, content: string) =>
    req<{ ok: boolean }>(`/missions/${missionId}/files/content`, {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    }),

  // Workspace panel — project scope (whole repo: source control + files + worktrees + branches)
  getProjectSource: (projectId: string) => req<SourceStatus & { worktrees: WorktreeInfo[]; branches: BranchInfo[] }>(`/projects/${projectId}/source`),
  getMissionStats: (projectId: string) =>
    req<{ stats: Record<string, Record<string, number>> }>(`/projects/${projectId}/mission-stats`),
  projectCommit: (projectId: string, message: string) =>
    req<{ sha: string }>(`/projects/${projectId}/source/commit`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  projectPush: (projectId: string) => req<{ ok: boolean }>(`/projects/${projectId}/source/push`, { method: 'POST' }),
  projectRevert: (projectId: string) => req<{ ok: boolean }>(`/projects/${projectId}/source/revert`, { method: 'POST' }),
  projectCreatePr: (projectId: string, title: string, body?: string) =>
    req<{ url: string }>(`/projects/${projectId}/source/pr`, {
      method: 'POST',
      body: JSON.stringify({ title, body: body ?? null }),
    }),
  projectDiff: (projectId: string, file: string) =>
    req<{ diff: string }>(`/projects/${projectId}/source/diff?file=${encodeURIComponent(file)}`),
  projectCheckout: (projectId: string, branch: string) =>
    req<{ ok: boolean; branch: string }>(`/projects/${projectId}/source/checkout`, {
      method: 'POST',
      body: JSON.stringify({ branch }),
    }),
  projectCommits: (projectId: string) => req<{ commits: CommitInfo[] }>(`/projects/${projectId}/source/commits`),
  listProjectFiles: (projectId: string, path = '') =>
    req<{ root: string; entries: FileEntry[] }>(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  readProjectFile: (projectId: string, path: string) =>
    req<{ content: string; truncated: boolean }>(`/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`),
  writeProjectFile: (projectId: string, path: string, content: string) =>
    req<{ ok: boolean }>(`/projects/${projectId}/files/content`, {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    }),

  // Resume: tasks in a problem state (blocked / failed run)
  listProblematicTasks: () => req<{ tasks: ProblematicTask[] }>('/tasks/problematic'),

  // Re-check stale task/mission state (watchdog): flags tasks left in an
  // active state with no live process (e.g. after a server restart) and
  // auto-retries them. Returns how many were recovered.
  runWatchdog: () => req<{ tasksRecovered: number; missionsRecovered: number }>('/watchdog', { method: 'POST' }),

  // Live status: which tasks/missions are marked active, and whether a real
  // OS process is alive behind each one. Lets the UI show "running" vs
  // "stale/crashed" (active state but no live process).
  getLiveStatus: () => req<{
    tasks: Array<{ taskId: string; runState: string; state: string; alive: boolean }>;
    missions: Array<{ missionId: string; state: string; alive: boolean }>;
  }>('/live-status'),

  // Health check: is the API up, is Hermes reachable, and which profiles are online.
  getHealth: () => req<{ apiOnline: boolean; hermesOnline: boolean; profiles: Array<{ name: string; online: boolean }>; timestamp: number }>('/health'),

  // Notification settings (sound on/off) — persisted server-side so the
  // preference survives across devices/browsers.
  getNotificationSettings: () => req<{ sound: boolean }>('/settings/notifications'),
  updateNotificationSettings: (body: { sound: boolean }) =>
    req<{ sound: boolean }>('/settings/notifications', { method: 'PATCH', body: JSON.stringify(body) }),

  // GitHub Tasks: PRs across all projects
  listPrs: () => req<{ prs: GithubPr[] }>('/prs'),
  getPrDetail: (projectId: string, number: number) =>
    req<{ pr: GithubPrDetail }>(`/projects/${projectId}/prs/${number}`),
  mergePr: (projectId: string, number: number, method: string, deleteLocal = false) =>
    req<{ ok: boolean }>(`/projects/${projectId}/prs/${number}/merge`, {
      method: 'POST',
      body: JSON.stringify({ method, deleteLocal }),
    }),
  setPrState: (projectId: string, number: number, closed: boolean) =>
    req<{ ok: boolean }>(`/projects/${projectId}/prs/${number}/state`, {
      method: 'POST',
      body: JSON.stringify({ closed }),
    }),
  addPrComment: (projectId: string, number: number, body: string) =>
    req<{ ok: boolean }>(`/projects/${projectId}/prs/${number}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  getPrDiff: (projectId: string, number: number) =>
    req<{ diff: string }>(`/projects/${projectId}/prs/${number}/diff`),
  createWorktreeFromPr: (projectId: string, number: number, branch: string) =>
    req<{ ok: boolean; path: string }>(`/projects/${projectId}/prs/${number}/worktree`, {
      method: 'POST',
      body: JSON.stringify({ branch }),
    }),

  // Notifications
  listNotifications: () => req<{ notifications: Notification[]; unread: number }>('/notifications'),
  markNotificationRead: (id: string) => req<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () => req<{ ok: boolean }>('/notifications/read-all', { method: 'POST' }),
  deleteNotification: (id: string) => req<{ ok: boolean }>(`/notifications/${id}`, { method: 'DELETE' }),
};

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
