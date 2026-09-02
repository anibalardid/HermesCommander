import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { LeftSidebar } from './LeftSidebar';
import { MobileNav } from './MobileNav';
import { CommandPalette } from './CommandPalette';
import { HermesChat } from './HermesChat';
import { Toaster } from './Toaster';
import { useStore } from '@/store';

export function AppShell() {
  const load = useStore((s) => s.load);
  const connectWs = useStore((s) => s.connectWs);
  const startLivePolling = useStore((s) => s.startLivePolling);
  const paletteOpen = useStore((s) => s.paletteOpen);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const location = useLocation();

  useEffect(() => {
    void load();
    connectWs();
    startLivePolling();
    const theme = localStorage.getItem('hermes-commander.theme') ?? 'system';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [load, connectWs, startLivePolling]);

  // Global Ctrl+K / Cmd+K shortcut to open the command palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen]);

  // Close the palette on navigation.
  useEffect(() => {
    setPaletteOpen(false);
  }, [location.pathname, setPaletteOpen]);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground md:h-screen md:overflow-hidden">
      {/* Left sidebar: desktop only (md+). Hidden on mobile. */}
      <div className="hidden w-60 md:block">
        <LeftSidebar />
      </div>

      {/* Center (detail/content) */}
      <main className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
        {/* Mobile-only header + drawer (hidden on md+) */}
        <MobileNav />
        <div className="flex-1 md:overflow-hidden">
          <Outlet />
        </div>
      </main>
      {/* Right sidebar (context) — reserved for on-demand drill-in */}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <HermesChat />
      <Toaster />
    </div>
  );
}
