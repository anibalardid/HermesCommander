import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileNav } from './MobileNav';
import { useStore } from '@/store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

describe('MobileNav', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
    act(() => useStore.getState().setMobileNavOpen(false));
  });

  it('opens the drawer when mobileNavOpen is set and closes on the X button', () => {
    render(
      <MemoryRouter>
        <MobileNav />
      </MemoryRouter>
    );

    act(() => useStore.getState().setMobileNavOpen(true));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape', () => {
    render(
      <MemoryRouter>
        <MobileNav />
      </MemoryRouter>
    );
    act(() => useStore.getState().setMobileNavOpen(true));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when a navigation option is selected', () => {
    render(
      <MemoryRouter>
        <MobileNav />
      </MemoryRouter>
    );
    act(() => useStore.getState().setMobileNavOpen(true));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /nav.home/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
