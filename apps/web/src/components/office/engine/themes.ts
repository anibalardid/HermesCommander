import type { ThemeId } from './world';

/** Per-theme color palettes for the office renderer. */
export type ThemeColors = {
  bg: string;
  floor: string;
  floorAlt: string;
  wall: string;
  wallTop: string;
  door: string;
  carpet: string;
  carpetAccent: string;
  furniture: string;
  furnitureDark: string;
  accent: string;
  nameTag: string;
  nameTagBg: string;
};

export const THEMES: Record<ThemeId, ThemeColors> = {
  modern: {
    bg: '#0f172a',
    floor: '#1e293b',
    floorAlt: '#263449',
    wall: '#334155',
    wallTop: '#475569',
    door: '#64748b',
    carpet: '#334155',
    carpetAccent: '#475569',
    furniture: '#8b5cf6',
    furnitureDark: '#4c1d95',
    accent: '#38bdf8',
    nameTag: '#e2e8f0',
    nameTagBg: 'rgba(15,23,42,0.7)',
  },
  cyberpunk: {
    bg: '#0a0a12',
    floor: '#141428',
    floorAlt: '#1a1a33',
    wall: '#2a1a4a',
    wallTop: '#3a2a6a',
    door: '#4a3a8a',
    carpet: '#1a1a33',
    carpetAccent: '#2a2a55',
    furniture: '#22d3ee',
    furnitureDark: '#0e7490',
    accent: '#f0abfc',
    nameTag: '#f0abfc',
    nameTagBg: 'rgba(10,10,18,0.7)',
  },
  cozy: {
    bg: '#1c1917',
    floor: '#292524',
    floorAlt: '#322d2a',
    wall: '#44403c',
    wallTop: '#57534e',
    door: '#78716c',
    carpet: '#3f3a36',
    carpetAccent: '#57534e',
    furniture: '#f59e0b',
    furnitureDark: '#92400e',
    accent: '#fbbf24',
    nameTag: '#fef3c7',
    nameTagBg: 'rgba(28,25,23,0.7)',
  },
};

/** Robot body colors per theme (for the procedural characters). */
export const ROBOT_COLORS: Record<ThemeId, string[]> = {
  modern: ['#22c55e', '#38bdf8', '#f472b6', '#a3e635', '#f59e0b'],
  cyberpunk: ['#22d3ee', '#f0abfc', '#a78bfa', '#34d399', '#fb7185'],
  cozy: ['#fbbf24', '#fb923c', '#a3e635', '#f472b6', '#60a5fa'],
};
