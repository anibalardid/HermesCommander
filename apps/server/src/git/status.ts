import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type FileStatus = {
  path: string;
  /** Short git status code: M (modified), A (added/untracked), D (deleted), R (renamed), ?? (untracked). */
  code: string;
  staged: boolean;
};

export type PullRequest = {
  number: number;
  title: string;
  state: string;
  branch: string;
  url: string;
};

export type SourceStatus = {
  branch: string | null;
  /** The repo's default/base branch (e.g. main/master). When branch === baseBranch,
   *  a PR can't be opened (head == base) — the UI shows Revert Changes instead. */
  baseBranch: string | null;
  worktreePath: string | null;
  files: FileStatus[];
  ahead: number;
  behind: number;
  prs: PullRequest[];
  ghAvailable: boolean;
  remoteUrl: string | null;
  /** Populated by the API layer (project & mission scopes) for the branch combobox + worktree list. */
  worktrees?: Array<{ path: string; branch: string | null; current: boolean }>;
  branches?: Array<{ name: string; current: boolean }>;
  /** Populated by the task scope: an existing open PR for the task's branch,
   *  so the UI can offer "View PR" instead of "create"/"no changes". */
  pr?: { url: string; number: number } | null;
};

/** Detect the git working dir: the project path, or a worktree path if provided. */
export function resolveWorkDir(repoPath: string, worktreePath?: string | null): string {
  return worktreePath && worktreePath.trim() ? worktreePath : repoPath;
}

/** Whether the GitHub CLI is available on PATH. */
export async function isGhAvailable(): Promise<boolean> {
  try {
    await exec('gh', ['--version'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Run git -C <dir> <args>, returning trimmed stdout, or null on error. */
async function git(dir: string, args: string[], timeout = 15000): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-C', dir, ...args], { timeout });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Run git and return raw stdout (no trim) — required for porcelain status where
 * leading whitespace is significant (e.g. " M file"). */
async function gitRaw(dir: string, args: string[], timeout = 15000): Promise<string> {
  const { stdout } = await exec('git', ['-C', dir, ...args], { timeout });
  return stdout;
}

/** Parse `git status --porcelain=v1` (line format) into structured entries.
 * Each line is `XY<space>path`; untracked is `?? <path>`; rename is `R  <old> -> <new>`.
 * IMPORTANT: do NOT trim the leading space — it's part of the XY codes (e.g. " M").
 */
function parsePorcelain(raw: string): FileStatus[] {
  if (!raw) return [];
  const files: FileStatus[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    // Rename: "R  old -> new" — take the destination path.
    if (line.startsWith('R')) {
      const arrow = line.indexOf('->');
      const newPath = arrow !== -1 ? line.slice(arrow + 2).trim() : line.slice(3).trim();
      files.push({ path: newPath, code: 'R', staged: true });
      continue;
    }
    const xy = line.slice(0, 2);
    const path = line.slice(3).trim(); // skip "XY "
    const staged = xy[0] !== ' ' && xy[0] !== '?';
    const worktree = xy[1];
    if (xy === '??') {
      // Untracked line is "?? path" (no leading space).
      files.push({ path: line.slice(3).trim(), code: '??', staged: false });
    } else {
      // Show the most meaningful code: staged (X) if present, else worktree (Y).
      const code = staged ? xy[0] : (worktree !== ' ' ? worktree : 'M');
      files.push({ path, code, staged });
    }
  }
  return files;
}

/** Full source-control status for a working dir: branch, dirty files, ahead/behind, PRs. */
export async function getSourceStatus(
  repoPath: string,
  worktreePath?: string | null
): Promise<SourceStatus> {
  const dir = resolveWorkDir(repoPath, worktreePath);
  const branch = await git(dir, ['branch', '--show-current']);
  const remoteUrl = await git(dir, ['remote', 'get-url', 'origin']);
  // Default branch: try the remote HEAD, else fall back to main/master.
  let baseBranch: string | null = null;
  const remoteHead = await git(dir, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  if (remoteHead) {
    baseBranch = remoteHead.replace(/^refs\/remotes\/origin\//, '');
  } else {
    const main = await git(dir, ['rev-parse', '--verify', 'origin/main']);
    const master = await git(dir, ['rev-parse', '--verify', 'origin/master']);
    baseBranch = main ? 'main' : master ? 'master' : null;
  }

  const rawStatus = await gitRaw(dir, ['status', '--porcelain=v1']);
  const files = parsePorcelain(rawStatus);

  // Ahead/behind vs upstream.
  let ahead = 0;
  let behind = 0;
  const revList = await git(dir, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (revList) {
    const [b, a] = revList.split(/\s+/).map((n) => parseInt(n, 10) || 0);
    ahead = a ?? 0;
    behind = b ?? 0;
  }

  const gh = await isGhAvailable();
  let prs: PullRequest[] = [];
  if (gh) {
    const ghOut = await git(dir, ['rev-parse', '--show-toplevel']); // verify it's a repo
    if (ghOut !== null) {
      try {
        const { stdout } = await exec(
          'gh',
          ['pr', 'list', '--json', 'number,title,state,headRefName,url', '--limit', '50'],
          { cwd: dir, timeout: 15000 }
        );
        prs = (JSON.parse(stdout) as Array<{
          number: number; title: string; state: string; headRefName: string; url: string;
        }>).map((p) => ({ number: p.number, title: p.title, state: p.state, branch: p.headRefName, url: p.url }));
      } catch {
        prs = [];
      }
    }
  }

  return { branch, baseBranch, worktreePath: dir, files, ahead, behind, prs, ghAvailable: gh, remoteUrl };
}

/** Stage all changes and commit with the given message. Returns the commit short SHA or null. */
export async function commitChanges(dir: string, message: string): Promise<string | null> {
  if (!message.trim()) return null;
  const add = await git(dir, ['add', '-A']);
  if (add === null) return null;
  const commit = await git(dir, ['commit', '-m', message]);
  if (commit === null) return null;
  return git(dir, ['rev-parse', '--short', 'HEAD']);
}

/** Push the current branch to origin (no force). Returns true on success. */
export async function push(dir: string): Promise<boolean> {
  const branch = await git(dir, ['branch', '--show-current']);
  if (!branch) return false;
  const result = await git(dir, ['push', 'origin', branch], 30000);
  return result !== null;
}

/** Discard all uncommitted changes (tracked + untracked) in the working dir.
 *  Equivalent to `git reset --hard HEAD` + `git clean -fd`. Returns true on success. */
export async function revertChanges(dir: string): Promise<boolean> {
  const reset = await git(dir, ['reset', '--hard', 'HEAD']);
  if (reset === null) return false;
  const clean = await git(dir, ['clean', '-fd']);
  return clean !== null;
}

/** Create a PR via `gh` (requires the GitHub CLI). Returns the PR URL or throws a readable error. */
export async function createPr(
  dir: string,
  title: string,
  body?: string | null,
  base?: string
): Promise<string> {
  if (!title.trim()) throw new Error('PR title is required');
  const gh = await isGhAvailable();
  if (!gh) throw new Error('GitHub CLI (gh) is not installed. Install gh or create the PR manually.');
  const args = ['pr', 'create', '--title', title];
  if (body?.trim()) args.push('--body', body);
  if (base?.trim()) args.push('--base', base);
  try {
    const { stdout } = await exec('gh', args, { cwd: dir, timeout: 30000 });
    return stdout.trim();
  } catch (e) {
    const err = e as { stderr?: string };
    throw new Error(err.stderr?.trim() || 'Failed to create PR');
  }
}

/** Get the unified diff for the given file (relative path) vs HEAD.
 *  Uses --no-ext-diff so a user's global `diff.external` (e.g. difft/icdiff)
 *  doesn't replace the standard unified diff the UI colorizes.
 *  Untracked files (??) aren't shown by `git diff`, so we render their full
 *  content as an "added" diff (every line prefixed with +) so the UI colors it. */
export async function getFileDiff(dir: string, file: string): Promise<string> {
  const raw = await git(dir, ['diff', '--no-ext-diff', '--', file]);
  if (raw === null) return '';
  if (raw.trim()) return raw;
  // Empty diff → likely an untracked file. Show it as fully added.
  const content = await git(dir, ['show', `:${file}`]);
  if (content === null) {
    // Not in the index either — read from disk (relative to the repo dir).
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    try {
      const disk = await readFile(join(dir, file), 'utf8');
      return disk.split('\n').map((l) => `+${l}`).join('\n');
    } catch {
      return '';
    }
  }
  return content.split('\n').map((l) => `+${l}`).join('\n');
}

export type CommitInfo = {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  /** Files changed in this commit: { path, code } where code is A/M/D. */
  files: Array<{ path: string; code: string }>;
};

/** List recent commits on the current branch (newest first), with changed files. */
export async function listCommits(dir: string, limit = 30): Promise<CommitInfo[]> {
  const raw = await git(
    dir,
    ['log', `-n ${limit}`, '--name-status', '--pretty=format:%x1e%H%x1f%h%x1f%s%x1f%an%x1f%cI'],
    15000
  );
  if (!raw) return [];
  // The \x1e separator precedes each commit header, so splitting on it yields
  // blocks of "<header>\nCODE\tpath\n..." — first line is the header, the rest
  // are name-status lines.
  return raw.split('\x1e').filter(Boolean).map((block) => {
    const lines = block.split('\n').filter(Boolean);
    const header = lines[0];
    const [sha, shortSha, message, author, date] = header.split('\x1f');
    const files = lines.slice(1).map((line) => {
      const [code, path] = line.split('\t');
      return { path: path ?? line, code: code ?? 'M' };
    });
    return { sha, shortSha, message, author, date, files };
  });
}
