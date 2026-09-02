import type { Store, NotificationRow } from './db/store.js';
import type { EventHub } from './runner/ws.js';

/**
 * Persist a notification and broadcast it live to every connected client over
 * the `office` WebSocket channel. The frontend maps `type` to localized strings,
 * so `title`/`body` stay short and English (i18n-neutral).
 */
export function notify(
  store: Store,
  hub: EventHub,
  type: string,
  title: string,
  body: string,
  link?: string | null
): NotificationRow {
  const notification = store.addNotification({ type, title, body, link: link ?? null });
  hub.emit('office', null, 'notification', { notification });
  return notification;
}
