/**
 * Dev prompt library integration.
 *
 * Source: f/awesome-chatgpt-prompts (the primary source behind the
 * awesome-ai-agent-tools catalog) — 158 developer-focused prompts with the
 * full prompt text, fetched from the raw CSV and cached in memory for 1 hour.
 *
 * The frontend never talks to the external source directly — it goes through
 * these backend endpoints.
 */

const CSV_URL = 'https://raw.githubusercontent.com/f/awesome-chatgpt-prompts/main/prompts.csv';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface DevPrompt {
  id: string;
  name: string;
  prompt: string;
  type: string;
  contributor: string | null;
}

interface CacheEntry {
  prompts: DevPrompt[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<DevPrompt[]> | null = null;

/** Parse the CSV (handles quoted fields with embedded commas/newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x.trim() !== '')) rows.push(row); }
  return rows;
}

/** Fetch the dev prompts (for_devs=TRUE) from the raw CSV. */
async function fetchDevPrompts(): Promise<DevPrompt[]> {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`prompt source ${res.status} ${res.statusText}`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('empty prompt source');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const actIdx = header.indexOf('act');
  const promptIdx = header.indexOf('prompt');
  const forDevsIdx = header.indexOf('for_devs');
  const typeIdx = header.indexOf('type');
  const contribIdx = header.indexOf('contributor');
  if (actIdx < 0 || promptIdx < 0 || forDevsIdx < 0) throw new Error('unexpected CSV schema');

  const out: DevPrompt[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const isDev = (r[forDevsIdx] ?? '').trim().toUpperCase() === 'TRUE';
    if (!isDev) continue;
    const name = (r[actIdx] ?? '').trim();
    const prompt = (r[promptIdx] ?? '').trim();
    if (!name || !prompt) continue;
    out.push({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      name,
      prompt,
      type: (r[typeIdx] ?? '').trim() || 'TEXT',
      contributor: (r[contribIdx] ?? '').trim() || null,
    });
  }
  return out;
}

/** Get the dev prompts, using the 1h cache. Concurrent callers share one fetch. */
export async function getDevPrompts(): Promise<DevPrompt[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.prompts;
  if (!inflight) {
    inflight = fetchDevPrompts()
      .then((prompts) => {
        cache = { prompts, fetchedAt: Date.now() };
        return prompts;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Search the dev prompts by text (name + prompt body). */
export async function searchPrompts(opts: { q?: string }): Promise<{ prompts: DevPrompt[]; total: number }> {
  const all = await getDevPrompts();
  const q = opts.q?.trim().toLowerCase();
  const prompts = q
    ? all.filter((p) => `${p.name} ${p.prompt}`.toLowerCase().includes(q))
    : all;
  return { prompts, total: prompts.length };
}
