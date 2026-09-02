import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell';

// Mock the store to avoid network calls in tests.
const mockState = {
  projects: [],
  missions: [],
  agentsConfig: [],
  loading: false,
  error: null,
  connected: false,
  paletteOpen: false,
  load: vi.fn(),
  refresh: vi.fn(),
  connectWs: vi.fn(),
  startLivePolling: vi.fn(),
  setPaletteOpen: vi.fn(),
  createProject: vi.fn(),
  createMission: vi.fn(),
  startMission: vi.fn(),
  pauseMission: vi.fn(),
  resumeMission: vi.fn(),
  stopMission: vi.fn(),
  setLanguage: vi.fn(),
  theme: 'system',
  setTheme: vi.fn(),
};
vi.mock('@/store', () => ({
  useStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

describe('AppShell layout', () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom doesn't implement matchMedia; stub it so theme init works.
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  });

  it('renders the app shell without crashing', () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
    // The main content area should render.
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
