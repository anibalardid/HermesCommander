/**
 * Tile-based office world: grid, rooms, furniture placement and BFS pathfinding.
 * Furniture footprints match the real pixel-agents sprites so nothing overlaps.
 */

export type TileType = 'floor' | 'wall' | 'door' | 'desk' | 'chair' | 'plant' | 'sofa' | 'table' | 'whiteboard' | 'coffee' | 'water' | 'bookshelf' | 'reception' | 'pc' | 'bin' | 'server' | 'holo' | 'fireplace' | 'kitchen' | 'carpet';

export type Tile = { type: TileType; walkable: boolean; color?: string };

export type Room = {
  id: number;
  name: string;
  x: number; y: number; w: number; h: number; // in tiles
  color: string;
};

export type Pos = { x: number; y: number };

export type ThemeId = 'modern' | 'cyberpunk' | 'cozy';

/** Furniture footprint in tiles (matches pixel-agents sprites). */
const FOOTPRINT: Record<string, { fw: number; fh: number; bg: number }> = {
  desk: { fw: 3, fh: 2, bg: 0 },
  chair: { fw: 1, fh: 1, bg: 0 },
  pc: { fw: 1, fh: 2, bg: 1 },
  plant: { fw: 1, fh: 2, bg: 1 },
  sofa: { fw: 2, fh: 1, bg: 0 },
  table: { fw: 2, fh: 2, bg: 0 },
  whiteboard: { fw: 2, fh: 2, bg: 0 },
  coffee: { fw: 1, fh: 1, bg: 0 },
  water: { fw: 1, fh: 2, bg: 1 },
  bookshelf: { fw: 2, fh: 1, bg: 0 },
  reception: { fw: 3, fh: 2, bg: 0 },
  bin: { fw: 1, fh: 1, bg: 0 },
  server: { fw: 1, fh: 2, bg: 1 },
  holo: { fw: 2, fh: 2, bg: 0 },
  fireplace: { fw: 1, fh: 2, bg: 1 },
  kitchen: { fw: 1, fh: 1, bg: 0 },
};

export class World {
  cols: number;
  rows: number;
  tiles: Tile[][] = [];
  rooms: Room[] = [];
  theme: ThemeId;

  constructor(cols: number, rows: number, theme: ThemeId) {
    this.cols = cols;
    this.rows = rows;
    this.theme = theme;
    this.initFloor();
    this.buildLayout();
  }

  private initFloor(): void {
    for (let y = 0; y < this.rows; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < this.cols; x++) {
        this.tiles[y][x] = { type: 'floor', walkable: true };
      }
    }
  }

  private set(x: number, y: number, type: TileType, walkable = false): void {
    if (x >= 0 && x < this.cols && y >= 0 && y < this.rows) {
      this.tiles[y][x] = { type, walkable };
    }
  }

  /** Place a furniture item at its top-left tile, marking its footprint non-walkable. */
  private place(x: number, y: number, type: TileType): void {
    const fp = FOOTPRINT[type];
    if (!fp) { this.set(x, y, type); return; }
    for (let yy = y; yy < y + fp.fh; yy++) {
      for (let xx = x; xx < x + fp.fw; xx++) {
        this.set(xx, yy, type, false);
      }
    }
  }

  private outerWalls(): void {
    for (let x = 0; x < this.cols; x++) { this.set(x, 0, 'wall'); this.set(x, this.rows - 1, 'wall'); }
    for (let y = 0; y < this.rows; y++) { this.set(0, y, 'wall'); this.set(this.cols - 1, y, 'wall'); }
  }

  private vDivider(x: number, yStart: number, yEnd: number, doorY: number, doorH = 2): void {
    for (let y = yStart; y < yEnd; y++) {
      if (y < doorY || y >= doorY + doorH) this.set(x, y, 'wall');
    }
  }

  private hDivider(y: number, xStart: number, xEnd: number, doorX: number, doorW = 2): void {
    for (let x = xStart; x < xEnd; x++) {
      if (x < doorX || x >= doorX + doorW) this.set(x, y, 'wall');
    }
  }

  private buildLayout(): void {
    this.outerWalls();
    if (this.theme === 'modern') this.buildModern();
    else if (this.theme === 'cyberpunk') this.buildCyberpunk();
    else this.buildCozy();
  }

  // ── MODERN: Reception / Meeting / Work / Cafeteria ──────────
  private buildModern(): void {
    const midX = Math.floor(this.cols / 2);
    const midY = Math.floor(this.rows / 2);
    this.vDivider(midX, 1, this.rows - 1, midY, 2);
    this.hDivider(midY, 1, this.cols - 1, midX, 2);
    this.set(midX, midY, 'door', true);
    this.set(midX, midY + 1, 'door', true);
    this.set(midX - 1, midY, 'door', true);
    this.set(midX + 1, midY, 'door', true);

    this.rooms = [
      { id: 0, name: 'Reception', x: 1, y: 1, w: midX - 1, h: midY - 1, color: '#3b82f6' },
      { id: 1, name: 'Meeting', x: midX + 1, y: 1, w: this.cols - midX - 2, h: midY - 1, color: '#f59e0b' },
      { id: 2, name: 'Work area', x: 1, y: midY + 1, w: midX - 1, h: this.rows - midY - 2, color: '#10b981' },
      { id: 3, name: 'Cafeteria', x: midX + 1, y: midY + 1, w: this.cols - midX - 2, h: this.rows - midY - 2, color: '#ec4899' },
    ];

    const [rec, meet, work, cafe] = this.rooms;
    // Reception: desk + plant
    this.place(rec.x + 2, rec.y + 2, 'reception');
    this.place(rec.x + rec.w - 2, rec.y + 2, 'plant');
    // Meeting: table + whiteboard + bookshelf
    const mtX = meet.x + Math.floor(meet.w / 2) - 1;
    const mtY = meet.y + Math.floor(meet.h / 2) - 1;
    this.place(mtX, mtY, 'table');
    this.place(meet.x + 1, meet.y + 1, 'whiteboard');
    this.place(meet.x + meet.w - 3, meet.y + 1, 'bookshelf');
    // Work area: 2 desks with PCs + chairs
    this.place(work.x + 2, work.y + 2, 'desk');
    this.place(work.x + 2, work.y + 4, 'pc');
    this.place(work.x + 2, work.y + 6, 'chair');
    this.place(work.x + 6, work.y + 2, 'desk');
    this.place(work.x + 6, work.y + 4, 'pc');
    this.place(work.x + 6, work.y + 6, 'chair');
    this.place(work.x + work.w - 2, work.y + 2, 'plant');
    this.place(work.x + work.w - 2, work.y + work.h - 3, 'water');
    // Cafeteria: coffee + sofa + table
    this.place(cafe.x + 2, cafe.y + 2, 'coffee');
    this.place(cafe.x + cafe.w - 4, cafe.y + 2, 'sofa');
    this.place(cafe.x + 2, cafe.y + cafe.h - 3, 'table');
    this.place(cafe.x + cafe.w - 2, cafe.y + cafe.h - 3, 'plant');
  }

  // ── CYBERPUNK: Server / Holo / Dev lab / Lounge ─────────────
  private buildCyberpunk(): void {
    const midX = Math.floor(this.cols / 2);
    const midY = Math.floor(this.rows / 2);
    this.vDivider(midX, 1, this.rows - 1, midY, 2);
    this.hDivider(midY, 1, this.cols - 1, midX, 2);
    this.set(midX, midY, 'door', true);
    this.set(midX, midY + 1, 'door', true);
    this.set(midX - 1, midY, 'door', true);
    this.set(midX + 1, midY, 'door', true);

    this.rooms = [
      { id: 0, name: 'Server room', x: 1, y: 1, w: midX - 1, h: midY - 1, color: '#22d3ee' },
      { id: 1, name: 'Holo meeting', x: midX + 1, y: 1, w: this.cols - midX - 2, h: midY - 1, color: '#f0abfc' },
      { id: 2, name: 'Dev lab', x: 1, y: midY + 1, w: midX - 1, h: this.rows - midY - 2, color: '#a78bfa' },
      { id: 3, name: 'Neon lounge', x: midX + 1, y: midY + 1, w: this.cols - midX - 2, h: this.rows - midY - 2, color: '#34d399' },
    ];

    const [server, holo, dev, lounge] = this.rooms;
    // Server room: racks
    this.place(server.x + 2, server.y + 2, 'server');
    this.place(server.x + 4, server.y + 2, 'server');
    this.place(server.x + server.w - 2, server.y + 2, 'plant');
    // Holo meeting: holo table
    const htX = holo.x + Math.floor(holo.w / 2) - 1;
    const htY = holo.y + Math.floor(holo.h / 2) - 1;
    this.place(htX, htY, 'holo');
    this.place(holo.x + 1, holo.y + 1, 'whiteboard');
    // Dev lab: 2 desks
    this.place(dev.x + 2, dev.y + 2, 'desk');
    this.place(dev.x + 2, dev.y + 4, 'pc');
    this.place(dev.x + 2, dev.y + 6, 'chair');
    this.place(dev.x + 6, dev.y + 2, 'desk');
    this.place(dev.x + 6, dev.y + 4, 'pc');
    this.place(dev.x + 6, dev.y + 6, 'chair');
    this.place(dev.x + dev.w - 2, dev.y + 2, 'server');
    this.place(dev.x + dev.w - 2, dev.y + dev.h - 3, 'water');
    // Neon lounge: coffee + sofa + holo
    this.place(lounge.x + 2, lounge.y + 2, 'coffee');
    this.place(lounge.x + lounge.w - 4, lounge.y + 2, 'sofa');
    this.place(lounge.x + 2, lounge.y + lounge.h - 3, 'holo');
    this.place(lounge.x + lounge.w - 2, lounge.y + lounge.h - 3, 'plant');
  }

  // ── COZY: Lounge / Kitchen / Reading / Work ─────────────────
  private buildCozy(): void {
    const midX = Math.floor(this.cols / 2);
    const midY = Math.floor(this.rows / 2);
    this.vDivider(midX, 1, this.rows - 1, midY, 2);
    this.hDivider(midY, 1, this.cols - 1, midX, 2);
    this.set(midX, midY, 'door', true);
    this.set(midX, midY + 1, 'door', true);
    this.set(midX - 1, midY, 'door', true);
    this.set(midX + 1, midY, 'door', true);

    this.rooms = [
      { id: 0, name: 'Lounge', x: 1, y: 1, w: midX - 1, h: midY - 1, color: '#fbbf24' },
      { id: 1, name: 'Kitchen', x: midX + 1, y: 1, w: this.cols - midX - 2, h: midY - 1, color: '#fb923c' },
      { id: 2, name: 'Reading', x: 1, y: midY + 1, w: midX - 1, h: this.rows - midY - 2, color: '#a3e635' },
      { id: 3, name: 'Work area', x: midX + 1, y: midY + 1, w: this.cols - midX - 2, h: this.rows - midY - 2, color: '#f472b6' },
    ];

    const [lounge, kitchen, reading, work] = this.rooms;
    // Lounge: fireplace + sofa + table
    this.place(lounge.x + 2, lounge.y + 2, 'fireplace');
    this.place(lounge.x + lounge.w - 4, lounge.y + 2, 'sofa');
    this.place(lounge.x + 2, lounge.y + lounge.h - 3, 'table');
    this.place(lounge.x + lounge.w - 2, lounge.y + lounge.h - 3, 'plant');
    // Kitchen: kitchen + coffee + table
    this.place(kitchen.x + 2, kitchen.y + 2, 'kitchen');
    this.place(kitchen.x + kitchen.w - 2, kitchen.y + 2, 'coffee');
    this.place(kitchen.x + 2, kitchen.y + kitchen.h - 3, 'table');
    this.place(kitchen.x + kitchen.w - 2, kitchen.y + kitchen.h - 3, 'plant');
    // Reading: bookshelves + sofa
    this.place(reading.x + 1, reading.y + 1, 'bookshelf');
    this.place(reading.x + reading.w - 3, reading.y + 1, 'bookshelf');
    this.place(reading.x + 2, reading.y + 3, 'sofa');
    this.place(reading.x + reading.w - 4, reading.y + 3, 'sofa');
    this.place(reading.x + 2, reading.y + reading.h - 3, 'plant');
    this.place(reading.x + reading.w - 2, reading.y + reading.h - 3, 'plant');
    // Work area: 2 desks
    this.place(work.x + 2, work.y + 2, 'desk');
    this.place(work.x + 2, work.y + 4, 'pc');
    this.place(work.x + 2, work.y + 6, 'chair');
    this.place(work.x + 6, work.y + 2, 'desk');
    this.place(work.x + 6, work.y + 4, 'pc');
    this.place(work.x + 6, work.y + 6, 'chair');
    this.place(work.x + work.w - 2, work.y + 2, 'plant');
    this.place(work.x + work.w - 2, work.y + work.h - 3, 'water');
  }

  isWalkable(x: number, y: number): boolean {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return false;
    return this.tiles[y][x].walkable;
  }

  /** BFS pathfinding between two walkable tiles. Returns array of positions (exclusive of start). */
  findPath(start: Pos, end: Pos): Pos[] {
    if (!this.isWalkable(end.x, end.y)) return [];
    const key = (p: Pos) => `${p.x},${p.y}`;
    const queue: Pos[] = [start];
    const visited = new Set<string>([key(start)]);
    const parent = new Map<string, Pos | null>();
    parent.set(key(start), null);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.x === end.x && cur.y === end.y) {
        const path: Pos[] = [];
        let node: Pos | null | undefined = cur;
        while (node) { path.unshift(node); node = parent.get(key(node)) ?? undefined; }
        return path.slice(1);
      }
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const next = { x: cur.x + dx, y: cur.y + dy };
        const k = key(next);
        if (!visited.has(k) && this.isWalkable(next.x, next.y)) {
          visited.add(k);
          parent.set(k, cur);
          queue.push(next);
        }
      }
    }
    return [];
  }

  /** A walkable tile near the center of a room (for agents to stand). */
  roomCenter(roomId: number): Pos {
    const r = this.rooms[roomId];
    return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
  }
}
