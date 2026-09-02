import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrDetailView } from './PrDetailView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: () => ({ projectId: 'p1', number: '12' }),
    useNavigate: () => vi.fn(),
  };
});

const mockPr = {
  projectId: 'p1', projectName: 'Repo A', number: 12, title: 'Fix auth flow',
  state: 'OPEN', branch: 'feature/auth', base: 'main', url: 'https://github.com/x/y/pull/12',
  author: 'alice', updatedAt: '2026-08-28T20:18:15Z', additions: 5, deletions: 2, mergeable: 'MERGEABLE',
  body: 'Fixes the auth flow.',
  comments: [],
  commentThreads: [],
  reviewers: [],
  assignees: [],
  files: [],
};

const mockCreateMission = vi.fn().mockResolvedValue({ id: 'm-review', project_id: 'p1', name: 'Review PR' });
const mockCreateTask = vi.fn().mockResolvedValue({ id: 't1' });

const mockRecipes = [
  { id: 'r1', name: 'frontend', title: 'Frontend', description: '', system_prompt: '', profile: null, provider: null, model: null, is_default: 0 },
  { id: 'r2', name: 'reviewer', title: 'Reviewer', description: '', system_prompt: '', profile: null, provider: null, model: null, is_default: 0 },
];

vi.mock('@/lib/api', () => ({
  api: {
    getPrDetail: () => Promise.resolve({ pr: mockPr }),
    listRecipes: () => Promise.resolve({ recipes: mockRecipes }),
    createTask: (...args: unknown[]) => mockCreateTask(...args),
  },
}));

// missions in the store: empty by default (so the modal creates a new one).
let mockMissions: unknown[] = [];
vi.mock('@/store', () => ({
  useStore: (selector: (s: unknown) => unknown) => selector({
    createMission: mockCreateMission,
    missions: mockMissions,
    // Notification bell (rendered in the header on every screen)
    notifications: [], unread: 0,
    loadNotifications: vi.fn(), markAllRead: vi.fn(), remove: vi.fn(),
  }),
}));

describe('PrDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the PR detail', async () => {
    render(
      <MemoryRouter>
        <PrDetailView />
      </MemoryRouter>
    );
    expect(await screen.findByText('Fix auth flow')).toBeInTheDocument();
  });

  it('creates a review mission + task from the Create task button', async () => {
    render(
      <MemoryRouter>
        <PrDetailView />
      </MemoryRouter>
    );
    // Open the modal (the action-row button).
    fireEvent.click(await screen.findByRole('button', { name: /office.createTask/i }));
    // The modal shows the mission name field (prefilled) and a Create button.
    expect(await screen.findByText('office.createReviewTitle')).toBeInTheDocument();
    // The task name is prefilled with "Review PR #12".
    const taskNameInput = screen.getByDisplayValue(/office.createReviewTask #12/i);
    expect(taskNameInput).toBeInTheDocument();
    // Select a subagent by its title (Reviewer).
    fireEvent.click(screen.getByRole('button', { name: 'Reviewer' }));
    // Submit — the modal's Create button is the LAST one with that name.
    const buttons = screen.getAllByRole('button', { name: /office.createTask/i });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => {
      expect(mockCreateMission).toHaveBeenCalledTimes(1);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
    });
    // The task uses the user's chosen name (prefilled "Review PR #12").
    const taskBody = mockCreateTask.mock.calls[0][1] as Record<string, unknown>;
    expect(taskBody.title).toContain('#12');
    // Subagents are stored by recipe NAME (matching the rest of the app).
    expect(taskBody.subagentIds).toEqual(['reviewer']);
    // The mission is created in the PR's project with the review name.
    const missionBody = mockCreateMission.mock.calls[0][0] as Record<string, unknown>;
    expect(missionBody.projectId).toBe('p1');
    expect(missionBody.name).toBe('office.createReviewMission');
  });

  it('does not create a task when no subagent is selected', async () => {
    render(
      <MemoryRouter>
        <PrDetailView />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: /office.createTask/i }));
    expect(await screen.findByText('office.createReviewTitle')).toBeInTheDocument();
    // The modal's Create button is disabled until a subagent is selected.
    const modalCreate = screen.getAllByRole('button', { name: /office.createTask/i }).find((b) => (b as HTMLButtonElement).disabled);
    expect(modalCreate).toBeTruthy();
    expect(modalCreate).toBeDisabled();
    fireEvent.click(modalCreate!);
    await waitFor(() => {
      expect(mockCreateMission).not.toHaveBeenCalled();
      expect(mockCreateTask).not.toHaveBeenCalled();
    });
  });

  it('reuses an existing Review PR mission instead of creating a new one', async () => {
    // A "Review PR" mission already exists in this project.
    mockMissions = [
      { id: 'm-existing', project_id: 'p1', name: 'office.createReviewMission' },
    ];
    render(
      <MemoryRouter>
        <PrDetailView />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: /office.createTask/i }));
    expect(await screen.findByText('office.createReviewTitle')).toBeInTheDocument();
    // Select a subagent so the Create button is enabled.
    fireEvent.click(screen.getByRole('button', { name: 'Reviewer' }));
    const buttons = screen.getAllByRole('button', { name: /office.createTask/i });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => {
      // No new mission is created — the existing one is reused.
      expect(mockCreateMission).not.toHaveBeenCalled();
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
    });
    // The task is created inside the existing mission.
    expect(mockCreateTask.mock.calls[0][0]).toBe('m-existing');
  });
});
