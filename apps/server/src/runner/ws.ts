import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

/** WebSocket event hub. Broadcasts events to subscribed clients (see docs/05-api.md). */
export class EventHub {
  private subscribers = new Map<string, Set<WebSocket>>();

  /** Register the /ws route. Requires @fastify/websocket registered on the app. */
  register(): void {
    // @fastify/websocket augments FastifyInstance with this overload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.app as any).get('/ws', { websocket: true }, (socket: WebSocket) => {
      socket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'subscribe') this.subscribe(msg.channel, socket);
          if (msg.type === 'unsubscribe') this.unsubscribe(msg.channel, socket);
        } catch {
          socket.send(JSON.stringify({ error: 'invalid message' }));
        }
      });
      socket.on('close', () => this.drop(socket));
    });
  }

  constructor(private app: FastifyInstance) {}

  subscribe(channel: string, socket: WebSocket): void {
    if (!this.subscribers.has(channel)) this.subscribers.set(channel, new Set());
    this.subscribers.get(channel)!.add(socket);
  }

  unsubscribe(channel: string, socket: WebSocket): void {
    this.subscribers.get(channel)?.delete(socket);
  }

  private drop(socket: WebSocket): void {
    for (const set of this.subscribers.values()) set.delete(socket);
  }

  emit(scope: 'office' | 'project' | 'mission', id: string | null, type: string, payload: unknown): void {
    const msg = JSON.stringify({ scope, id, type, payload, at: Date.now() });
    const channels = new Set<string>(['office']);
    if (id) channels.add(`${scope}:${id}`);
    for (const ch of channels) {
      this.subscribers.get(ch)?.forEach((s) => {
        if (s.readyState === s.OPEN) s.send(msg);
      });
    }
  }
}
