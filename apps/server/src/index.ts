import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { Store } from './db/store.js';
import { EventHub } from './runner/ws.js';
import { MissionRunner } from './runner/runner.js';
import { registerApiRoutes } from './api/routes.js';
import { registerTerminalRoutes } from './terminal/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    runner: MissionRunner;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  const dbPath = process.env.HERMES_COMMANDER_DB ?? 'data/hermes-commander.db';
  const store = new Store(dbPath);
  const hub = new EventHub(app);
  hub.register();
  const runner = new MissionRunner(store, hub);
  app.decorate('runner', runner);

  // Start the stale-state watchdog: every 30s, flag tasks/missions that claim to
  // be active but have no live process behind them (crash / reboot / lost comm).
  const watchdogMs = Number(process.env.HERMES_COMMANDER_WATCHDOG_MS ?? 30_000);
  const watchdogTimer = setInterval(() => {
    void runner.watchdog().then((r) => {
      if (r.tasksRecovered || r.missionsRecovered) {
        app.log.warn(`watchdog recovered ${r.tasksRecovered} tasks, ${r.missionsRecovered} missions`);
      }
    });
  }, watchdogMs);
  watchdogTimer.unref();

  registerApiRoutes(app, store, hub);
  registerTerminalRoutes(app);

  // Serve the built frontend (apps/web/dist) in production, if present.
  const webDist = process.env.HERMES_COMMANDER_WEB_DIST ?? join(__dirname, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    // SPA fallback: any non-API route serves index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

const PORT = Number(process.env.PORT ?? 4310);
const HOST = process.env.HOST ?? '0.0.0.0';

if (process.env.NODE_ENV !== 'test') {
  const app = await buildApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Hermes Commander server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
