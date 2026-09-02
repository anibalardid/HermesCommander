import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OfficeView } from './OfficeView';

// Mock i18n so t() returns the key (or a readable label).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const mockState = {
  projects: [
    { id: 'p1', name: 'Repo A', path: '/a', type: 'git', remote_url: null, created_by: 'open', badge_color: null, parent_group: null, created_at: 0, updated_at: 0 },
  ],
  missions: [
    { id: 'm1', project_id: 'p1', name: 'Fix auth', objective: 'Refactor', git_strategy: 'worktree', base_branch: null, worktree_path: null, driver_type: 'hermes', driver_profile: null, driver_model: 'm', driver_provider: null, driver_worktree_flag: 0, uses_kanban: 1, intervention: 'autonomous', depends_on_mission_ids: '[]', max_concurrent: null, state: 'running', session_id: null, created_at: 0, started_at: null, finished_at: null, updated_at: 0 },
  ],
  agentsConfig: [],
  loading: false,
  error: null,
  connected: false,
  load: vi.fn(),
  refresh: vi.fn(),
  connectWs: vi.fn(),
  createProject: vi.fn(),
  createMission: vi.fn(),
  startMission: vi.fn(),
  pauseMission: vi.fn(),
  resumeMission: vi.fn(),
  stopMission: vi.fn(),
  setLanguage: vi.fn(),
  toggleTheme: vi.fn(),
  setPaletteOpen: vi.fn(),
  notifications: [],
  unread: 0,
  loadNotifications: vi.fn(),
  markAllRead: vi.fn(),
  markRead: vi.fn(),
  remove: vi.fn(),
};
vi.mock('@/store', () => ({
  useStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getStats: vi.fn().mockResolvedValue({ stats: { total: 1, active: 0, done: 0, failed: 0 } }),
    listProblematicTasks: vi.fn().mockResolvedValue({ tasks: [] }),
    listPrs: vi.fn().mockResolvedValue({ prs: [] }),
    getMissionStats: vi.fn().mockResolvedValue({ stats: {} }),
  },
}));

describe('OfficeView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the add-project FAB', () => {
    render(
      <MemoryRouter>
        <OfficeView />
      </MemoryRouter>
    );
    expect(screen.getAllByLabelText('nav.addProject').length).toBeGreaterThanOrEqual(1);
  });

  it('renders project names in the list', async () => {
    render(
      <MemoryRouter>
        <OfficeView />
      </MemoryRouter>
    );
    expect(await screen.findByText('Repo A')).toBeInTheDocument();
  });

  it('shows a Git Tasks entry linking to /tasks', async () => {
    render(
      <MemoryRouter>
        <OfficeView />
      </MemoryRouter>
    );
    const link = await screen.findByRole('link', { name: /office.gitTasks/i });
    expect(link).toHaveAttribute('href', '/tasks');
  });
});
