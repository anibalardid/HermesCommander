import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', '..', 'scripts', 'hermes_query.py');

// Hermes ships its own venv with the deps (yaml, etc.) the query script needs.
const HERMES_HOME = process.env.HERMES_HOME || join(process.env.HOME || '', '.hermes', 'hermes-agent');
const VENV_PY = join(HERMES_HOME, 'venv', 'bin', 'python');

function pythonBin(): string {
  if (existsSync(VENV_PY)) return VENV_PY;
  return 'python3';
}

async function run(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(pythonBin(), [SCRIPT, ...args], {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** List Hermes profiles (the orchestrator is always Hermes). */
export async function listHermesProfiles(): Promise<{ name: string; model: string; provider: string }[]> {
  try {
    const res = (await run(['profiles'])) as { name: string; model: string; provider: string }[];
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

/** List recent interactive sessions for a Hermes profile (default or named).
 * Used by the floating chat to let the user resume a previous conversation. */
export async function listHermesSessions(
  profile?: string,
  source?: string,
  limit = 20
): Promise<Array<{ id: string; source: string; title: string; preview: string; model: string; last_active?: number }>> {
  try {
    const args = ['sessions'];
    if (profile) args.push('--profile', profile);
    if (source) args.push('--source', source);
    args.push('--limit', String(limit));
    const res = (await run(args)) as Array<{ id: string; source: string; title: string; preview: string; model: string; last_active?: number }>;
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

/** List all canonical Hermes providers. */
export async function listHermesProviders(): Promise<string[]> {
  try {
    const res = (await run(['providers'])) as string[];
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

/**
 * Health check: is the Hermes CLI reachable, and which profiles are online?
 * Returns { hermesOnline, profiles: [{ name, online }] }. A profile is
 * "online" if the Hermes CLI responds to a `profiles` query (i.e. the
 * binary + its config are reachable). Used by the Settings "Healthy" panel.
 */
export async function hermesHealth(): Promise<{ hermesOnline: boolean; profiles: Array<{ name: string; online: boolean }> }> {
  const profiles = await listHermesProfiles();
  const hermesOnline = profiles.length > 0;
  return {
    hermesOnline,
    profiles: profiles.map((p) => ({ name: p.name, online: hermesOnline })),
  };
}

/** List models for a given Hermes provider. */
export async function listHermesModels(provider: string): Promise<string[]> {
  try {
    const res = (await run(['models', provider])) as string[];
    return Array.isArray(res) ? res : [];
  } catch {
    return [];
  }
}

/**
 * One-shot chat with a Hermes profile. Returns the assistant's final reply
 * (and the underlying session_id). Used by the floating Hermes chat in the UI.
 */
export async function chatWithHermes(
  message: string,
  opts: { profile?: string; model?: string; provider?: string; session_id?: string } = {}
): Promise<{ reply: string; session_id?: string }> {
  const args = ['chat'];
  if (opts.profile) args.push('-p', opts.profile);
  if (opts.model) args.push('-m', opts.model);
  if (opts.provider) args.push('--provider', opts.provider);
  // Resume a previous conversation if a session_id was selected.
  if (opts.session_id) args.push('--resume', opts.session_id);
  args.push('-q', message, '--quiet', '--source', 'tool', '--max-turns', '20');

  let stdout = '';
  try {
    const { stdout: out } = await execFileAsync('hermes', args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    stdout = out;
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    stdout = e.stdout ?? '';
    if (!stdout) return { reply: `hermes error: ${e.message ?? 'unknown'}` };
  }
  // Strip the trailing session_id footer; keep the assistant's reply.
  const sessionMatch = stdout.match(/session_id:\s*(\S+)/);
  const reply = sessionMatch
    ? stdout.slice(0, sessionMatch.index).trim()
    : stdout.trim();
  return { reply: reply || '(empty reply)', session_id: sessionMatch?.[1] };
}

/**
 * List installed Hermes skills grouped by category. Reads the skills directories
 * on disk (~/.hermes/skills and per-profile skills). Top-level folders are
 * categories; a category folder may contain skill subfolders (each with a
 * SKILL.md) or be a skill itself. Returns { category, skills } entries.
 */
export async function listHermesSkills(): Promise<Array<{ category: string; skills: string[] }>> {
  try {
    const { readdirSync, statSync } = await import('node:fs');
    const home = process.env.HOME || '';
    const root = process.env.HERMES_HOME
      ? join(process.env.HERMES_HOME, 'skills')
      : join(home, '.hermes', 'skills');
    const groups: Array<{ category: string; skills: string[] }> = [];
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('__') || entry.name.startsWith('.')) continue;
        const full = join(root, entry.name);
        // A category folder contains skill subfolders (each with SKILL.md).
        const sub = readdirSync(full, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith('__') && !e.name.startsWith('.'))
          .map((e) => e.name)
          .sort();
        if (sub.length > 0) {
          groups.push({ category: entry.name, skills: sub });
        } else {
          // Standalone skill (no subfolders) — treat as its own category.
          groups.push({ category: entry.name, skills: [] });
        }
      }
    } catch { /* no skills dir */ }
    return groups.sort((a, b) => a.category.localeCompare(b.category));
  } catch {
    return [];
  }
}

/**
 * List configured MCP servers from the Hermes config (config.yaml).
 * Uses the Hermes venv python (which has PyYAML) for reliable parsing.
 * Returns { name, enabled, command } entries.
 */
export async function listHermesMcpServers(): Promise<Array<{ name: string; enabled: boolean; command: string }>> {
  try {
    const home = process.env.HOME || '';
    const configPath = process.env.HERMES_HOME
      ? join(process.env.HERMES_HOME, 'config.yaml')
      : join(home, '.hermes', 'config.yaml');
    const venvPy = join(process.env.HERMES_HOME || join(home, '.hermes', 'hermes-agent'), 'venv', 'bin', 'python');
    const code = [
      "import sys, yaml, json",
      `cfg = yaml.safe_load(open(sys.argv[1]))`,
      "servers = cfg.get('mcp_servers', {}) or {}",
      "out = [{'name': n, 'enabled': bool(s.get('enabled', True)), 'command': str(s.get('command', ''))} for n, s in servers.items()]",
      "print(json.dumps(out))",
    ].join('; ');
    const { stdout } = await execFileAsync(venvPy, ['-c', code, configPath], {
      timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
    }).catch(() => ({ stdout: '[]' }));
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
