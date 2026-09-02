import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, X, CheckCheck } from '@/components/icons';
import { useStore } from '@/store';
import { relativeTime } from '@/lib/utils';
import type { Notification } from '@/lib/types';

/**
 * Notification bell + dropdown panel.
 *
 * - Renders a bell button (top-right) with an unread badge (count + accent).
 * - The bell pulses when a new notification arrives (see `.bell-pulse`).
 * - Clicking opens a dropdown listing notifications (newest first), each with
 *   title, body, relative time, and a per-item dismiss (×).
 * - Opening the panel optimistically marks all as read and clears the badge.
 *
 * The bell is placed in the app header on ALL breakpoints; on mobile the
 * secondary header actions collapse into a kebab menu (see OfficeView) so the
 * bell always stays reachable.
 */
export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const notifications = useStore((s) => s.notifications);
  const unread = useStore((s) => s.unread);
  const loadNotifications = useStore((s) => s.loadNotifications);
  const markAllRead = useStore((s) => s.markAllRead);
  const remove = useStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const prevUnread = useRef(unread);

  // Load persisted notifications once on mount.
  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  // Pulse the bell whenever the unread count increases (a new notification).
  useEffect(() => {
    if (unread > prevUnread.current) {
      setPulse(true);
      const id = setTimeout(() => setPulse(false), 650);
      prevUnread.current = unread;
      return () => clearTimeout(id);
    }
    prevUnread.current = unread;
  }, [unread]);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Opening the panel marks everything read and clears the badge.
    if (next && unread > 0) void markAllRead();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={t('notifications.title')}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Bell className={`icon-anim h-5 w-5 ${pulse ? 'bell-pulse' : ''}`} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('notifications.title')}
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">{t('notifications.title')}</span>
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t('notifications.empty')}
              </div>
            ) : (
              <ul className="divide-y">
                {notifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    locale={i18n.language}
                    onDismiss={() => void remove(n.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  locale,
  onDismiss,
}: {
  notification: Notification;
  locale: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const unread = notification.read === 0;
  // Map the notification type to a status color dot shown to the left of the
  // title, so the user can tell at a glance whether the item is a completion
  // (green), a failure (red), or something else (neutral).
  const dotCls = NOTIF_DOT[notification.type] ?? 'bg-muted-foreground/50';
  return (
    <li
      className={`relative flex items-start gap-2 px-3 py-2.5 ${
        unread ? 'border-l-2 border-l-primary bg-accent/40' : ''
      }`}
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotCls}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{notification.title}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {relativeTime(notification.created_at, locale)}
          </span>
        </div>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{notification.body}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('notifications.dismiss')}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

// Status color per notification type (mirrors the run-state colors used in the
// kanban badges: green = done, red = failed, blue = running/active).
const NOTIF_DOT: Record<string, string> = {
  task_done: 'bg-green-500',
  subtask_done: 'bg-green-500',
  mission_done: 'bg-green-500',
  task_failed: 'bg-red-500',
  subtask_failed: 'bg-red-500',
  mission_failed: 'bg-red-500',
  task_running: 'bg-blue-500',
  subtask_running: 'bg-blue-500',
  mission_running: 'bg-blue-500',
};
