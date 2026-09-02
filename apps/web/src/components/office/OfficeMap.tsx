import { useEffect, useRef } from 'react';
import type { Mission } from '@/lib/types';

/**
 * Pixel-art 2D office map rendered on a plain HTML5 canvas (no external deps).
 *
 * Each mission becomes a little pixel character that walks between sectors
 * based on its state:
 *   - running  -> Work area (desks)
 *   - paused   -> Meeting room
 *   - failed   -> Reception (red)
 *   - pending  -> Cafeteria
 *   - done     -> Cafeteria / break
 *
 * The office is furnished with procedural pixel furniture (desks, chairs,
 * plants, whiteboards, water cooler, coffee machine, sofas, meeting table)
 * inspired by projects like Thinkroid-Space, JINXUS and pixel-agents.
 *
 * Characters move smoothly (lerp) toward their target sector and idle-bob in
 * place. Clicking a character opens the mission detail page.
 */

type Sector = { x: number; y: number; w: number; h: number; label: string; color: string };

const SECTORS: Sector[] = [
  { x: 8, y: 8, w: 120, h: 64, label: 'Reception', color: '#3b82f6' },
  { x: 140, y: 8, w: 120, h: 64, label: 'Meeting room', color: '#f59e0b' },
  { x: 8, y: 84, w: 120, h: 64, label: 'Work area', color: '#10b981' },
  { x: 140, y: 84, w: 120, h: 64, label: 'Cafeteria', color: '#ec4899' },
];

const TILE = 8; // pixel scale

type Agent = {
  id: string;
  name: string;
  state: Mission['state'];
  x: number;
  y: number;
  tx: number;
  ty: number;
  bob: number;
  color: string;
};

function sectorCenter(s: Sector): { x: number; y: number } {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

function stateSector(state: Mission['state']): Sector {
  switch (state) {
    case 'running': return SECTORS[2];
    case 'paused': return SECTORS[1];
    case 'failed': return SECTORS[0];
    case 'done': return SECTORS[3];
    default: return SECTORS[3];
  }
}

function stateColor(state: Mission['state']): string {
  switch (state) {
    case 'running': return '#22c55e';
    case 'paused': return '#eab308';
    case 'failed': return '#ef4444';
    case 'done': return '#a3e635';
    default: return '#94a3b8';
  }
}

/** Draw a small pixel desk with a chair. */
function drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number, color = '#8b5cf6') {
  // desk top
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 14, 4);
  // desk legs
  ctx.fillStyle = '#4c1d95';
  ctx.fillRect(x, y + 4, 2, 3);
  ctx.fillRect(x + 12, y + 4, 2, 3);
  // chair
  ctx.fillStyle = '#64748b';
  ctx.fillRect(x + 3, y + 8, 8, 2);
  ctx.fillRect(x + 3, y + 6, 2, 2);
}

/** Draw a small potted plant. */
function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#78350f';
  ctx.fillRect(x, y + 4, 6, 3);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(x + 2, y, 2, 4);
  ctx.fillRect(x, y + 1, 2, 2);
  ctx.fillRect(x + 4, y + 1, 2, 2);
}

/** Draw a whiteboard on a wall. */
function drawWhiteboard(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(x, y, 16, 10);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, 16, 10);
  // scribbles
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(x + 2, y + 2, 3, 2);
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(x + 7, y + 4, 4, 2);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(x + 3, y + 7, 5, 2);
}

/** Draw a water cooler. */
function drawWaterCooler(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(x, y, 6, 8);
  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(x + 1, y, 4, 3);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(x + 2, y + 4, 2, 2);
}

/** Draw a coffee machine. */
function drawCoffee(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#475569';
  ctx.fillRect(x, y, 8, 8);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(x + 1, y + 1, 6, 2);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(x + 2, y + 4, 4, 2);
  // steam
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(x + 3, y - 2, 1, 2);
  ctx.fillRect(x + 5, y - 3, 1, 2);
}

/** Draw a sofa. */
function drawSofa(ctx: CanvasRenderingContext2D, x: number, y: number, color = '#f472b6') {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 14, 5);
  ctx.fillRect(x, y - 2, 14, 2);
  // armrests
  ctx.fillRect(x, y - 2, 2, 7);
  ctx.fillRect(x + 12, y - 2, 2, 7);
}

/** Draw a meeting table with chairs around it. */
function drawMeetingTable(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#a16207';
  ctx.fillRect(x, y, 20, 10);
  ctx.fillStyle = '#ca8a04';
  ctx.fillRect(x + 1, y + 1, 18, 8);
  // chairs around
  ctx.fillStyle = '#64748b';
  ctx.fillRect(x + 2, y - 3, 4, 3);
  ctx.fillRect(x + 14, y - 3, 4, 3);
  ctx.fillRect(x + 2, y + 10, 4, 3);
  ctx.fillRect(x + 14, y + 10, 4, 3);
}

/** Draw a bookshelf. */
function drawBookshelf(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#78350f';
  ctx.fillRect(x, y, 12, 12);
  ctx.fillStyle = '#b45309';
  ctx.fillRect(x + 1, y + 1, 10, 3);
  ctx.fillRect(x + 1, y + 5, 10, 3);
  ctx.fillRect(x + 1, y + 9, 10, 3);
  // books
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(x + 2, y + 1, 2, 3);
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(x + 5, y + 1, 2, 3);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(x + 8, y + 1, 2, 3);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(x + 2, y + 5, 2, 3);
  ctx.fillStyle = '#ec4899';
  ctx.fillRect(x + 5, y + 5, 2, 3);
}

/** Draw a reception desk. */
function drawReceptionDesk(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#7c3aed';
  ctx.fillRect(x, y, 18, 6);
  ctx.fillStyle = '#5b21b6';
  ctx.fillRect(x, y + 6, 18, 2);
  // monitor
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(x + 3, y - 4, 6, 4);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(x + 4, y - 3, 4, 2);
}

export function OfficeMap({ missions, onSelect }: { missions: Mission[]; onSelect: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef<Map<string, Agent>>(new Map());
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Canvas logical size (fixed grid, scaled by CSS).
    canvas.width = 268;
    canvas.height = 156;

    // (Re)build agents from missions, keeping existing positions for continuity.
    const agents = agentsRef.current;
    for (const m of missions) {
      const existing = agents.get(m.id);
      if (existing) {
        existing.state = m.state;
        existing.name = m.name;
        existing.color = stateColor(m.state);
        const c = sectorCenter(stateSector(m.state));
        existing.tx = c.x;
        existing.ty = c.y;
      } else {
        const c = sectorCenter(stateSector(m.state));
        agents.set(m.id, {
          id: m.id,
          name: m.name,
          state: m.state,
          x: c.x,
          y: c.y,
          tx: c.x,
          ty: c.y,
          bob: Math.random() * Math.PI * 2,
          color: stateColor(m.state),
        });
      }
    }
    // Remove agents whose mission disappeared.
    const ids = new Set(missions.map((m) => m.id));
    for (const id of [...agents.keys()]) if (!ids.has(id)) agents.delete(id);

    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // Background
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Floor tiles (checkerboard)
      ctx.fillStyle = '#1e293b';
      for (let y = 0; y < canvas.height; y += TILE) {
        for (let x = 0; x < canvas.width; x += TILE) {
          if ((x / TILE + y / TILE) % 2 === 0) ctx.fillRect(x, y, TILE, TILE);
        }
      }

      // Sectors (rooms) with walls
      for (const s of SECTORS) {
        ctx.fillStyle = s.color + '18';
        ctx.fillRect(s.x, s.y, s.w, s.h);
        // wall
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x, s.y, s.w, 2);
        ctx.fillRect(s.x, s.y, 2, s.h);
        ctx.fillRect(s.x + s.w - 2, s.y, 2, s.h);
        ctx.fillRect(s.x, s.y + s.h - 2, s.w, 2);
        // label
        ctx.fillStyle = s.color;
        ctx.font = '6px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(s.label.toUpperCase(), s.x + s.w / 2, s.y + 10);
      }

      // Furniture per sector
      // Reception: desk + plant
      drawReceptionDesk(ctx, 20, 20);
      drawPlant(ctx, 100, 20);
      // Meeting room: table + whiteboard + bookshelf
      drawMeetingTable(ctx, 160, 30);
      drawWhiteboard(ctx, 150, 12);
      drawBookshelf(ctx, 230, 12);
      // Work area: desks + plants + water cooler
      drawDesk(ctx, 20, 100);
      drawDesk(ctx, 50, 100);
      drawDesk(ctx, 80, 100);
      drawPlant(ctx, 20, 130);
      drawWaterCooler(ctx, 110, 100);
      // Cafeteria: coffee machine + sofa + table
      drawCoffee(ctx, 150, 100);
      drawSofa(ctx, 180, 100);
      drawSofa(ctx, 210, 100, '#a78bfa');
      drawPlant(ctx, 240, 100);

      // Move + draw agents
      for (const a of agents.values()) {
        // Lerp toward target
        const speed = 30 * dt;
        const dx = a.tx - a.x;
        const dy = a.ty - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1) {
          a.x += (dx / dist) * Math.min(speed, dist);
          a.y += (dy / dist) * Math.min(speed, dist);
        }
        a.bob += dt * 3;

        // Character (pixel body)
        const px = Math.round(a.x);
        const py = Math.round(a.y + Math.sin(a.bob) * 1.5);
        // Head
        ctx.fillStyle = '#fcd34d';
        ctx.fillRect(px - 2, py - 5, 4, 4);
        // Body
        ctx.fillStyle = a.color;
        ctx.fillRect(px - 3, py - 1, 6, 5);
        // Legs
        ctx.fillStyle = '#334155';
        ctx.fillRect(px - 2, py + 4, 2, 2);
        ctx.fillRect(px + 1, py + 4, 2, 2);
        // Name tag
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '5px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(a.name.length > 12 ? a.name.slice(0, 11) + '…' : a.name, px, py + 12);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [missions]);

  // Click handling: find the nearest agent within a radius.
  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    let best: { id: string; d: number } | null = null;
    for (const a of agentsRef.current.values()) {
      const d = Math.hypot(a.x - mx, a.y - my);
      if (d < 10 && (!best || d < best.d)) best = { id: a.id, d };
    }
    if (best) onSelect(best.id);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="w-full max-w-2xl cursor-pointer rounded-lg border border-border/60 bg-[#0f172a]"
        style={{ imageRendering: 'pixelated' }}
      />
      <div className="flex flex-wrap items-center justify-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> running</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500" /> paused</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> failed</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-lime-400" /> done</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> pending</span>
      </div>
    </div>
  );
}
