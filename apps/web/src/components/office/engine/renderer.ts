import type { World, Tile, Pos, ThemeId } from './world';
import { THEMES, type ThemeColors } from './themes';

export type Agent = {
  id: string;
  name: string;
  state: string;
  color: string;
  gx: number;
  gy: number;
  path: Pos[];
  pathIndex: number;
  walkPhase: number;
  facing: Facing;
  bob: number;
};

export type Facing = 'down' | 'up' | 'left' | 'right';

const TILE = 16; // logical px per tile

// ── Asset loading ─────────────────────────────────────────────
const imgCache = new Map<string, HTMLImageElement | null>();

function loadImg(url: string): HTMLImageElement | null {
  if (imgCache.has(url)) return imgCache.get(url) ?? null;
  const img = new Image();
  img.src = url;
  imgCache.set(url, img);
  return img;
}

/** The cozy robot is used in ALL themes (user's choice). */
function robotUrl(facing: Facing): string {
  return `/office-assets/gen/robot_cozy_${facing}.png`;
}

/** Real pixel-agents furniture (MIT) with natural size + footprint. */
interface FurnSpec {
  file: string;
  w: number; // natural px width
  h: number; // natural px height
  fw: number; // footprint tiles wide
  fh: number; // footprint tiles high
  bg: number; // background rows above footprint anchor
}

const FURN: Record<string, FurnSpec> = {
  desk: { file: 'DESK_DESK_FRONT.png', w: 48, h: 32, fw: 3, fh: 2, bg: 0 },
  chair: { file: 'CUSHIONED_CHAIR_CUSHIONED_CHAIR_FRONT.png', w: 16, h: 16, fw: 1, fh: 1, bg: 0 },
  pc: { file: 'PC_PC_FRONT_OFF.png', w: 16, h: 32, fw: 1, fh: 2, bg: 1 },
  plant: { file: 'PLANT_2_PLANT_2.png', w: 16, h: 32, fw: 1, fh: 2, bg: 1 },
  sofa: { file: 'SOFA_SOFA_FRONT.png', w: 32, h: 16, fw: 2, fh: 1, bg: 0 },
  table: { file: 'COFFEE_TABLE_COFFEE_TABLE.png', w: 32, h: 32, fw: 2, fh: 2, bg: 0 },
  whiteboard: { file: 'WHITEBOARD_WHITEBOARD.png', w: 32, h: 32, fw: 2, fh: 2, bg: 0 },
  coffee: { file: 'COFFEE_COFFEE.png', w: 16, h: 16, fw: 1, fh: 1, bg: 0 },
  water: { file: 'PLANT_2_PLANT_2.png', w: 16, h: 32, fw: 1, fh: 2, bg: 1 },
  bookshelf: { file: 'BOOKSHELF_BOOKSHELF.png', w: 32, h: 16, fw: 2, fh: 1, bg: 0 },
  reception: { file: 'DESK_DESK_FRONT.png', w: 48, h: 32, fw: 3, fh: 2, bg: 0 },
  bin: { file: 'BIN_BIN.png', w: 16, h: 16, fw: 1, fh: 1, bg: 0 },
  server: { file: 'PC_PC_SIDE.png', w: 16, h: 32, fw: 1, fh: 2, bg: 1 },
  holo: { file: 'COFFEE_TABLE_COFFEE_TABLE.png', w: 32, h: 32, fw: 2, fh: 2, bg: 0 },
  fireplace: { file: 'PLANT_PLANT.png', w: 16, h: 32, fw: 1, fh: 2, bg: 1 },
  kitchen: { file: 'COFFEE_COFFEE.png', w: 16, h: 16, fw: 1, fh: 1, bg: 0 },
};

function furnUrl(kind: string): string {
  return `/office-assets/furniture/${FURN[kind]?.file ?? 'BIN_BIN.png'}`;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private world: World;
  private colors: ThemeColors;
  private scale: number;

  constructor(canvas: HTMLCanvasElement, world: World, scale = 2) {
    this.ctx = canvas.getContext('2d')!;
    this.world = world;
    this.scale = scale;
    this.colors = THEMES[world.theme];
    this.ctx.imageSmoothingEnabled = false;
    canvas.width = world.cols * TILE * scale;
    canvas.height = world.rows * TILE * scale;
  }

  render(agents: Agent[]): void {
    const { ctx, world, colors, scale } = this;
    const ts = TILE * scale;

    // Background
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Floor tiles (checkerboard)
    for (let y = 0; y < world.rows; y++) {
      for (let x = 0; x < world.cols; x++) {
        const t = world.tiles[y][x];
        const px = x * ts;
        const py = y * ts;
        if (t.type === 'floor' || t.type === 'carpet' || t.type === 'door') {
          const accent = (x * 7 + y * 13) % 11 === 0;
          ctx.fillStyle = accent && (x + y) % 2 === 0 ? shade(colors.floor, 6) : (x + y) % 2 === 0 ? colors.floor : colors.floorAlt;
          ctx.fillRect(px, py, ts, ts);
        } else if (t.type === 'wall') {
          ctx.fillStyle = colors.wall;
          ctx.fillRect(px, py, ts, ts);
          ctx.fillStyle = colors.wallTop;
          ctx.fillRect(px, py, ts, 4 * scale);
          ctx.fillStyle = shade(colors.wallTop, 15);
          ctx.fillRect(px, py, ts, scale);
        }
      }
    }

    // Room labels
    ctx.font = `${Math.max(6, 5 * scale)}px monospace`;
    ctx.textAlign = 'center';
    for (const r of world.rooms) {
      const cx = (r.x + r.w / 2) * ts;
      const cy = (r.y + 1) * ts;
      ctx.fillStyle = r.color;
      ctx.fillText(r.name.toUpperCase(), cx, cy);
    }

    // Furniture — real pixel-agents sprites, drawn once at footprint anchor
    const drawn = new Set<string>();
    for (let y = 0; y < world.rows; y++) {
      for (let x = 0; x < world.cols; x++) {
        const t = world.tiles[y][x];
        if (t.type === 'floor' || t.type === 'wall' || t.type === 'door' || t.type === 'carpet') continue;
        const spec = FURN[t.type];
        if (!spec) continue;
        // only draw at the top-left anchor of the footprint
        const isAnchor = !(x > 0 && world.tiles[y][x - 1].type === t.type) &&
                         !(y > 0 && world.tiles[y - 1][x].type === t.type);
        if (!isAnchor) continue;
        const key = `${x},${y}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const img = loadImg(furnUrl(t.type));
        if (img && img.complete && img.naturalWidth > 0) {
          const dx = x * ts;
          const dy = (y - spec.bg) * ts;
          ctx.drawImage(img, dx, dy, spec.w * scale, spec.h * scale);
        }
      }
    }

    // Agents — z-sorted by y, cozy robot in all themes
    const sorted = [...agents].sort((a, b) => a.gy - b.gy);
    for (const a of sorted) {
      const px = a.gx * ts;
      const py = a.gy * ts;

      // ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(px + 3 * scale, py + 30 * scale, 10 * scale, 3 * scale);

      // cozy robot sprite
      const img = loadImg(robotUrl(a.facing));
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, px, py, 16 * scale, 32 * scale);
      }

      // name tag
      ctx.font = `${Math.max(5, 4 * scale)}px monospace`;
      ctx.textAlign = 'center';
      const label = a.name.length > 10 ? a.name.slice(0, 9) + '…' : a.name;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = colors.nameTagBg;
      ctx.fillRect(px + ts / 2 - tw / 2 - 2, py + 30 * scale + 3, tw + 4, 7 * scale);
      ctx.fillStyle = colors.nameTag;
      ctx.fillText(label, px + ts / 2, py + 30 * scale + 8 * scale);
    }
  }
}

function shade(hex: string, pct: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16 & 255) + Math.round(255 * pct / 100)));
  const g = Math.max(0, Math.min(255, (n >> 8 & 255) + Math.round(255 * pct / 100)));
  const b = Math.max(0, Math.min(255, (n & 255) + Math.round(255 * pct / 100)));
  return `rgb(${r},${g},${b})`;
}
