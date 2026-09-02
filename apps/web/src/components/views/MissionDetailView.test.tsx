import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MissionDetailView } from './MissionDetailView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// Hoisted so the vi.mock factories below can reference them.
const h = vi.hoisted(() => {
  const mockMission = {
    id: 'm1', project_id: 'p1', name: 'Fix auth', objective: 'Refactor', git_strategy: 'worktree',
    base_branch: null, worktree_path: null, driver_type: 'hermes', driver_profile: null,
    driver_model: 'm', driver_provider: null, driver_worktree_flag: 0, uses_kanban: 1,
    intervention: 'autonomous', depends_on_mission_ids: '[]', max_concurrent: null,
    state: 'pending', session_id: null, created_at: 0, started_at: null, finished_at: null, updated_at: 0,
  };
  const mockDetail = {
    mission: mockMission,
    tasks: [
      { id: 't1', mission_id: 'm1', title: 'Write tests', description: 'Add unit tests', state: 'todo', parent_id: null, depends_on: '[]', agent_type: 'codex', agent_llm: null, agent_system_prompt: null, sort_order: 0, created_at: 0, updated_at: 0 },
      // Orchestrator in 'doing' with its subtasks in 'todo' — reproduces the
      // bug where subtasks whose parent lives in another column silently vanish.
      { id: 't2', mission_id: 'm1', title: 'Orchestrator', description: null, state: 'doing', parent_id: null, depends_on: '[]', agent_type: null, agent_llm: null, agent_system_prompt: null, sort_order: 1, created_at: 0, updated_at: 0 },
      { id: 't3', mission_id: 'm1', title: 'Subtask A', description: null, state: 'todo', run_state: 'idle', parent_id: 't2', depends_on: '[]', agent_type: null, agent_llm: null, agent_system_prompt: null, sort_order: 0, created_at: 0, updated_at: 0 },
      { id: 't4', mission_id: 'm1', title: 'Subtask B', description: null, state: 'todo', run_state: 'idle', parent_id: 't2', depends_on: '[]', agent_type: null, agent_llm: null, agent_system_prompt: null, sort_order: 1, created_at: 0, updated_at: 0 },
    ],
    runs: [],
  };
  const mockState = {
    missions: [mockMission],
    projects: [],
    agentsConfig: [],
    liveTasks: {},
    loading: false, error: null, connected: false,
    load: vi.fn(), refresh: vi.fn(), connectWs: vi.fn(),
    createProject: vi.fn(), createMission: vi.fn(),
    startMission: vi.fn(), pauseMission: vi.fn(), resumeMission: vi.fn(), stopMission: vi.fn(),
    subscribeMission: vi.fn(), unsubscribeMission: vi.fn(),
    onMissionEvent: vi.fn(() => () => {}),
    setLanguage: vi.fn(), toggleTheme: vi.fn(),
    // Notification bell (rendered in the header on every screen)
    notifications: [], unread: 0,
    loadNotifications: vi.fn(), markAllRead: vi.fn(), remove: vi.fn(),
  };
  return { mockMission, mockDetail, mockState };
});

vi.mock('@/store', () => {
  const useStore = (selector?: (s: typeof h.mockState) => unknown) =>
    selector ? selector(h.mockState) : h.mockState;
  useStore.getState = () => h.mockState;
  return { useStore };
});

vi.mock('@/lib/api', () => ({
  api: {
    getMission: vi.fn().mockResolvedValue(h.mockDetail),
    listRunsForMission: vi.fn().mockResolvedValue({ runs: [] }),
    listRunsForTask: vi.fn().mockResolvedValue({ runs: [] }),
    listMissionEvents: vi.fn().mockResolvedValue({ events: [] }),
    listMissionLogs: vi.fn().mockResolvedValue({ logs: [] }),
    listLogsForRun: vi.fn().mockResolvedValue({ logs: [] }),
    listRecipes: vi.fn().mockResolvedValue({ recipes: [] }),
    updateTask: vi.fn().mockImplementation((id, body) =>
      Promise.resolve({ ...h.mockDetail.tasks[0], ...body })),
    getSourceStatus: vi.fn().mockResolvedValue({
      branch: 'main', worktreePath: null, files: [], ahead: 0, behind: 0,
      prs: [], ghAvailable: false, remoteUrl: null,
    }),
    sourceCommit: vi.fn().mockResolvedValue({ sha: 'abc' }),
    sourcePush: vi.fn().mockResolvedValue({ ok: true }),
    sourceCreatePr: vi.fn().mockResolvedValue({ url: 'http://x' }),
    sourceDiff: vi.fn().mockResolvedValue({ diff: '' }),
    listFiles: vi.fn().mockResolvedValue({ root: '/x', entries: [] }),
    readFile: vi.fn().mockResolvedValue({ content: '', truncated: false }),
  },
}));

function renderView() {
  // jsdom doesn't implement matchMedia; stub it so the workspace panel works.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
  return render(
    <MemoryRouter initialEntries={['/mission/m1']}>
      <Routes>
        <Route path="/mission/:id" element={<MissionDetailView />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('MissionDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders the mission name and task', async () => {
    renderView();
    expect(await screen.findByText('Fix auth')).toBeInTheDocument();
    expect(await screen.findByText('Write tests')).toBeInTheDocument();
  });

  it('opens the task detail bottom sheet on click', async () => {
    renderView();
    const task = await screen.findByText('Write tests');
    fireEvent.click(task);
    expect(await screen.findByText('task.detail')).toBeInTheDocument();
    expect((await screen.findAllByText('Add unit tests')).length).toBeGreaterThan(0);
  });

  it('renders subtasks even when their parent is in a different column', async () => {
    renderView();
    // The orchestrator (doing) and its two subtasks (todo) must all be visible.
    expect(await screen.findByText('Orchestrator')).toBeInTheDocument();
    expect(await screen.findByText('Subtask A')).toBeInTheDocument();
    expect(await screen.findByText('Subtask B')).toBeInTheDocument();
  });

  it('groups a family together and shows subtask run-state badges', async () => {
    renderView();
    // The orchestrator (doing) pulls its whole family into the 'doing' column.
    // Its subtasks (todo/idle) must NOT appear in the 'todo' column — they
    // travel with the parent. Each subtask shows a run-state badge.
    expect(await screen.findByText('Orchestrator')).toBeInTheDocument();
    expect(await screen.findByText('Subtask A')).toBeInTheDocument();
    expect(await screen.findByText('Subtask B')).toBeInTheDocument();
    // Subtask A/B are 'todo'/'idle' → the same run-state badge shown in the
    // modal ("runState.idle"), not a separate "waiting" legend.
    expect((await screen.findAllByText('task.runState.idle')).length).toBeGreaterThanOrEqual(2);
  });

  it('opens the workspace panel from the topbar button', async () => {
    renderView();
    // The panel is closed by default — logs are not visible.
    expect(screen.queryByText('workspace.logs')).not.toBeInTheDocument();
    const btn = await screen.findByLabelText('workspace.title');
    fireEvent.click(btn);
    expect(await screen.findByText('workspace.logs')).toBeInTheDocument();
  });
});
