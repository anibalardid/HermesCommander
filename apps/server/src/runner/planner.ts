import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Store, MissionRow, SubagentRecipeRow } from '../db/store.js';

const exec = promisify(execFile);

/**
 * Planned subtask produced by the orchestrator's planning pass.
 */
export type PlannedSubtask = {
  title: string;
  description?: string;
  agentType?: string;      // recipe name, e.g. 'frontend', 'reviewer'
  agentModel?: string;
  agentProvider?: string;
  dependsOnTitles?: string[];
};

/** Result of a planning pass: an overall spec (SDD) + the subtask breakdown. */
export type PlanResult = {
  spec?: string;
  subtasks: PlannedSubtask[];
};

/**
 * Restrict the available recipes to the ones the user pre-selected on the
 * task. If `selected` is empty/undefined, all recipes are returned.
 */
export function filterRecipes(
  recipes: SubagentRecipeRow[],
  selected?: string[]
): SubagentRecipeRow[] {
  if (!selected || selected.length === 0) return recipes;
  const chosen = new Set(selected);
  return recipes.filter((r) => chosen.has(r.name));
}

/** Extract a JSON array of subtasks from a possibly-noisy agent reply. */
export function parsePlannedSubtasks(text: string): PlannedSubtask[] {
  // The model is asked to reply with ONLY a JSON object. Try parsing the whole
  // reply first (fast path). If that fails (e.g. prose around the JSON), find
  // the first JSON object and read its "subtasks" array.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = extractJsonObject(text);
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const arr = (parsed as Record<string, unknown>).subtasks;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && typeof x.title === 'string' && x.title.trim())
    .map((x) => ({
      title: String(x.title).trim(),
      description: typeof x.description === 'string' ? x.description : undefined,
      agentType: typeof x.agentType === 'string' ? x.agentType : undefined,
      agentModel: typeof x.agentModel === 'string' ? x.agentModel : undefined,
      agentProvider: typeof x.agentProvider === 'string' ? x.agentProvider : undefined,
      dependsOnTitles: Array.isArray(x.dependsOnTitles)
        ? x.dependsOnTitles.map((d: unknown) => String(d)) : undefined,
    }));
}

/**
 * Find the first top-level JSON object in a possibly-noisy reply and parse it.
 * Balances braces while respecting string literals, so braces inside strings
 * (e.g. "${var,,}", "[[ =~ ]]") don't break the scan.
 */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Extract the overall spec (SDD) from a planner reply. The planner returns a
 * JSON object `{"spec": "...", "subtasks": [...]}`. Falls back to the mission
 * objective if no spec field is present.
 */
export function parsePlanSpec(text: string, fallback: string): string {
  const start = text.indexOf('{');
  if (start === -1) return fallback;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) return fallback;
  try {
    const parsed = JSON.parse(text.slice(start, end));
    if (parsed && typeof parsed.spec === 'string' && parsed.spec.trim()) {
      return parsed.spec.trim();
    }
  } catch {
    // ignore — fall through to fallback
  }
  return fallback;
}

/**
 * Builds the prompt that instructs the planner to produce an overall spec (SDD)
 * and break the objective into subtasks (never to write code), returning strict
 * JSON `{"spec": "...", "subtasks": [...]}`.
 */
export function buildPlanPrompt(
  objective: string,
  recipes: SubagentRecipeRow[],
  context: string[] = []
): string {
  // Give the orchestrator each recipe's name, title and description so it can
  // assign the RIGHT subagent to each subtask with a detailed spec.
  const recipeList = recipes
    .map((r) => `- "${r.name}" (${r.title}): ${r.description || 'no description'}`)
    .join('\n');
  const ctx = context.length ? `\n\nAdditional context:\n${context.join('\n')}` : '';
  return [
    `You are the ORCHESTRATOR for this mission. Your ONLY task is to PLAN — you must NOT write, edit, or execute any code yourself.`,
    ``,
    `Mission objective:\n"""${objective}"""`,
    ctx,
    ``,
    `First, write a concise overall SPEC (a short SDD / design doc) for the whole objective: the goal, the approach, the key decisions, and the acceptance criteria. This spec is the single source of truth the subtasks work against.`,
    ``,
    `Then break this objective into a minimal set of subtasks, each assigned to one available subagent recipe.`,
    `Available subagent recipes (name — what they do):\n${recipeList}`,
    `Use "reviewer" as the final subtask (a gate that verifies the work against the spec — it must come last and depend on all implementation subtasks).`,
    ``,
    `For EACH subtask, write a detailed, self-contained spec: what to build, the acceptance criteria, and any constraints. The subagent will receive ONLY this description, so it must be complete enough for a capable engineer to implement without further context.`,
    ``,
    `Respond with ONLY a valid JSON object, no prose, no markdown fences. Shape:`,
    `{"spec": string (the overall spec/SDD), "subtasks": [{"title": string, "description": string (detailed spec), "agentType": string (recipe name), "dependsOnTitles": [string] | null}]}.`,
    `Keep it concise — 3 to 8 subtasks.`,
  ].join('\n');
}

/**
 * Run a one-shot Hermes planning pass that returns an overall spec + structured
 * subtasks. The planner runs WITHOUT a worktree so it cannot touch the repo — it
 * only reasons and returns the breakdown. Uses the orchestrator (parent task)
 * driver config when provided, else falls back to the mission's.
 */
export async function runPlanner(
  store: Store,
  mission: MissionRow,
  cfg?: { profile: string | null; model: string | null; provider: string | null },
  objective?: string,
  context: string[] = [],
  selectedRecipes?: string[]
): Promise<{ ok: boolean; spec?: string; subtasks?: PlannedSubtask[]; reason?: string }> {
  let recipes = store.listRecipes();
  // If the user pre-selected subagent recipes on the task, restrict the planner
  // to those choices (the orchestrator must only assign subtasks to the chosen
  // subagents). Otherwise fall back to all available recipes.
  recipes = filterRecipes(recipes, selectedRecipes);
  const prompt = buildPlanPrompt(objective ?? mission.objective, recipes, context);

  const args = ['chat'];
  const profile = cfg?.profile ?? mission.driver_profile;
  const model = cfg?.model ?? mission.driver_model;
  const provider = cfg?.provider ?? mission.driver_provider;
  if (profile) args.push('-p', profile);
  if (model) args.push('-m', model);
  if (provider) args.push('--provider', provider);
  args.push('-q', prompt, '--quiet', '--source', 'tool', '--max-turns', '20');

  let stdout = '';
  try {
    const { stdout: out } = await exec('hermes', args, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
    stdout = out;
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    stdout = e.stdout ?? '';
    if (!stdout) return { ok: false, reason: `planner failed: ${e.message ?? 'unknown'}` };
  }

  // The planner is a non-deterministic LLM call: it sometimes returns prose or
  // markdown that doesn't parse into {subtasks:[...]}. Retry a few times before
  // giving up, so a single flaky reply doesn't fail the whole task.
  let subtasks = parsePlannedSubtasks(stdout);
  let attempts = 1;
  while (subtasks.length === 0 && attempts < 3) {
    attempts += 1;
    try {
      const { stdout: out } = await exec('hermes', args, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
      stdout = out;
    } catch (err) {
      const e = err as { stdout?: string; message?: string };
      stdout = e.stdout ?? '';
      if (!stdout) return { ok: false, reason: `planner failed: ${e.message ?? 'unknown'}` };
    }
    subtasks = parsePlannedSubtasks(stdout);
  }
  if (subtasks.length === 0) {
    return { ok: false, reason: 'planner returned no usable breakdown' };
  }
  const spec = parsePlanSpec(stdout, objective ?? mission.objective);
  return { ok: true, spec, subtasks };
}
