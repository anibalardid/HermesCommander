import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Shared modal container classes — bottom sheet on mobile (w-full, anchored
 * bottom), centered wide modal on desktop/tablet (sm:max-w-5xl). Used by all
 * modals/bottom sheets so they're consistent in width.
 */
export const modalSheetCls =
  'max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 shadow-xl sm:max-w-5xl sm:rounded-2xl sm:border sm:border-border';


/**
 * Build a GitHub web URL for a repo + branch from a git remote URL.
 * Handles https://github.com/user/repo.git and git@github.com:user/repo.git.
 * Returns null when the remote isn't a GitHub URL.
 */
/**
 * Human-friendly relative time ("just now", "5 minutes ago", "2 days ago")
 * using the browser's native Intl.RelativeTimeFormat, localized to the given
 * locale (e.g. 'en' or 'es'). `ts` is a millisecond epoch timestamp.
 */
export function relativeTime(ts: number, locale: string, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffSec = Math.round((ts - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  const min = Math.round(diffSec / 60);
  if (Math.abs(min) < 60) return rtf.format(min, 'minute');
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 24) return rtf.format(hr, 'hour');
  const day = Math.round(hr / 24);
  if (Math.abs(day) < 30) return rtf.format(day, 'day');
  const month = Math.round(day / 30);
  if (Math.abs(month) < 12) return rtf.format(month, 'month');
  return rtf.format(Math.round(month / 12), 'year');
}

export function githubRepoUrl(remoteUrl: string | null | undefined, branch?: string | null): string | null {
  if (!remoteUrl) return null;
  let m = remoteUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!m) return null;
  const repo = m[1];
  const base = `https://github.com/${repo}`;
  return branch ? `${base}/tree/${encodeURIComponent(branch)}` : base;
}

/**
 * Mission status dot color, derived from the mission's task-state counters
 * ({ todo, doing, blocked, done } — top-level tasks only).
 *
 *   - gray   → no tasks, or all tasks are in todo
 *   - red    → 1+ task blocked/failed (regardless of the rest)
 *   - green  → all tasks done
 *   - blue   → all tasks in doing (in-progress/running)
 *   - yellow → mixed states (more than one task in different states, none failed)
 */
export function missionDotColor(stats?: { todo?: number; doing?: number; blocked?: number; done?: number } | null): string {
  const todo = stats?.todo ?? 0;
  const doing = stats?.doing ?? 0;
  const blocked = stats?.blocked ?? 0;
  const done = stats?.done ?? 0;
  const total = todo + doing + blocked + done;
  if (total === 0 || todo === total) return 'bg-muted-foreground/50';
  if (blocked > 0) return 'bg-red-500';
  if (done === total) return 'bg-green-500';
  if (doing === total) return 'bg-blue-500';
  return 'bg-yellow-500';
}
