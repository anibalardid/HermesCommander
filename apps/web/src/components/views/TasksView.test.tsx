import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TasksView } from './TasksView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const mockPrs = {
  prs: [
    {
      projectId: 'p1', projectName: 'Repo A', number: 12, title: 'Fix auth flow',
      state: 'OPEN', branch: 'feature/auth', base: 'main', url: 'https://github.com/x/y/pull/12',
      author: 'alice', updatedAt: '2026-08-28T20:18:15Z', additions: 5, deletions: 2, mergeable: 'MERGEABLE',
    },
    {
      projectId: 'p2', projectName: 'Repo B', number: 3, title: 'Add tests',
      state: 'MERGED', branch: 'feature/tests', base: 'main', url: 'https://github.com/x/z/pull/3',
      author: 'bob', updatedAt: '2026-08-27T10:00:00Z', additions: 20, deletions: 0, mergeable: null,
    },
  ],
};

vi.mock('@/lib/api', () => ({
  api: { listPrs: () => Promise.resolve(mockPrs) },
}));

describe('TasksView', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders PRs from all projects', async () => {
    render(
      <MemoryRouter>
        <TasksView />
      </MemoryRouter>
    );
    expect(await screen.findByText('Fix auth flow')).toBeInTheDocument();
    expect(await screen.findByText('Add tests')).toBeInTheDocument();
  });
});
