import { useEffect, useRef } from 'react';
import type { Mission } from '@/lib/types';
import { World, type ThemeId, type Pos } from './engine/world';
import { Renderer, type Agent } from './engine/renderer';
import { ROBOT_COLORS } from './engine/themes';

/** Map a mission state to a room id (0=Reception,1=Meeting,2=Work,3=Cafeteria). */
function stateRoom(state: Mission['state']): number {
  switch (state) {
    case 'running': return 2;
    case 'paused': return 1;
    case 'failed': return 0;
    case 'done': return 3;
    default: return 3;
  }
}

export function OfficeCanvas({
  missions,
  theme,
  onSelect,
}: {
  missions: Mission[];
  theme: ThemeId;
  onSelect: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const agentsRef = useRef<Map<string, Agent>>(new Map());
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = new World(21, 16, theme);
    worldRef.current = world;
    const renderer = new Renderer(canvas, world, 2);

    const agents = agentsRef.current;
    const colors = ROBOT_COLORS[theme];

    // (Re)build agents from missions, keeping positions for continuity.
    for (const m of missions) {
      const existing = agents.get(m.id);
      const room = stateRoom(m.state);
      const target = world.roomCenter(room);
      if (existing) {
        existing.state = m.state;
        existing.name = m.name;
        existing.color = colors[Math.abs(hash(m.id)) % colors.length];
        // Recompute path if target changed
        if (existing.path.length === 0 || existing.path[existing.path.length - 1].x !== target.x || existing.path[existing.path.length - 1].y !== target.y) {
          const start: Pos = { x: Math.round(existing.gx), y: Math.round(existing.gy) };
          existing.path = world.findPath(start, target);
          existing.pathIndex = 0;
        }
      } else {
        const start = world.roomCenter(room);
        agents.set(m.id, {
          id: m.id,
          name: m.name,
          state: m.state,
          color: colors[Math.abs(hash(m.id)) % colors.length],
          gx: start.x,
          gy: start.y,
          path: [],
          pathIndex: 0,
          walkPhase: 0,
          facing: 'down',
          bob: Math.random() * Math.PI * 2,
        });
      }
    }
    // Remove agents whose mission disappeared.
    const ids = new Set(missions.map((m) => m.id));
    for (const id of [...agents.keys()]) if (!ids.has(id)) agents.delete(id);

    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      for (const a of agents.values()) {
        // Follow path
        if (a.pathIndex < a.path.length) {
          const target = a.path[a.pathIndex];
          const speed = 4 * dt; // tiles per second
          const dx = target.x - a.gx;
          const dy = target.y - a.gy;
          const dist = Math.hypot(dx, dy);
          if (dist < speed) {
            a.gx = target.x;
            a.gy = target.y;
            a.pathIndex++;
          } else {
            a.gx += (dx / dist) * speed;
            a.gy += (dy / dist) * speed;
            // facing
            if (Math.abs(dx) > Math.abs(dy)) a.facing = dx > 0 ? 'right' : 'left';
            else a.facing = dy > 0 ? 'down' : 'up';
            a.walkPhase += dt * 3;
          }
        } else {
          a.walkPhase = 0;
          a.bob += dt * 2;
        }
      }

      renderer.render([...agents.values()]);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [missions, theme]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    const ts = 16 * 2; // tile size * scale
    let best: { id: string; d: number } | null = null;
    for (const a of agentsRef.current.values()) {
      const ax = a.gx * ts + ts / 2;
      const ay = a.gy * ts + ts / 2;
      const d = Math.hypot(ax - mx, ay - my);
      if (d < ts && (!best || d < best.d)) best = { id: a.id, d };
    }
    if (best) onSelect(best.id);
  }

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className="w-full max-w-3xl cursor-pointer rounded-lg border border-border/60"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
