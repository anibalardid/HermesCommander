import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Wrap `git worktree` for mission isolation.
 * When `fromBranch` is set, the new worktree's branch is created FROM that
 * branch (e.g. a fix branch derived from a PR head branch) instead of from
 * the repo's current HEAD.
 */
export async function createWorktree(repoPath: string, name: string, branch?: string | null, fromBranch?: string | null): Promise<string> {
  let safeName = name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase();
  // Git rejects branch names that end in a dot or a dash (e.g. a task title
  // ending in "."). Trim trailing dots/dashes so the derived branch is valid.
  safeName = safeName.replace(/[.\-]+$/g, '') || 'task';
  // Worktrees live OUTSIDE the project folder (one level up) so they don't
  // show up as untracked files inside the repo. e.g. ~/Projects/.hermes-commander-wt/<name>
  const parent = dirname(repoPath);
  const root = join(parent, '.hermes-commander-wt');
  mkdirSync(root, { recursive: true });
  const path = join(root, safeName);
  // Idempotent: if the worktree already exists (e.g. a previous run left it
  // behind), reuse it instead of failing.
  const existing = await listWorktrees(repoPath);
  if (existing.some((w) => w.path === path)) {
    // If we're checking out a specific branch (e.g. a PR's head branch), the
    // PR may have been updated on the remote since the worktree was created.
    // Always fetch the latest and reset the worktree to it so a review task
    // sees the current code, not a stale snapshot.
    if (branch) {
      await syncWorktreeToBranch(repoPath, path, branch);
    }
    return path;
  }
  if (branch) {
    // If we're creating a NEW branch derived from a base branch (a fix branch
    // from a PR head branch), the branch doesn't exist yet — create it from
    // `fromBranch` instead of checking out an existing branch.
    if (fromBranch) {
      const branchName = branch;
      try {
        await exec('git', ['worktree', 'add', '-b', branchName, path, fromBranch], { cwd: repoPath, timeout: 30_000 });
      } catch (err) {
        // Branch may already exist from a previous run — reuse it.
        try {
          await exec('git', ['worktree', 'add', path, branchName], { cwd: repoPath, timeout: 30_000 });
        } catch (err2) {
          await exec('git', ['worktree', 'prune'], { cwd: repoPath });
          await exec('rm', ['-rf', path]);
          await exec('git', ['worktree', 'add', path, branchName], { cwd: repoPath });
        }
      }
      return path;
    }
    // Check out an existing branch (e.g. a PR's head branch) rather than
    // creating a new mission branch from the current HEAD. This is what lets a
    // review task work on the PR's actual code instead of main.
    try {
      await exec('git', ['worktree', 'add', path, branch], { cwd: repoPath, timeout: 30_000 });
    } catch (err) {
      // Branch may not exist locally yet — fetch it from origin first, then retry.
      try {
        await exec('git', ['-C', repoPath, 'fetch', 'origin', `${branch}:refs/heads/${branch}`], { timeout: 30_000 });
        await exec('git', ['worktree', 'add', path, branch], { cwd: repoPath, timeout: 30_000 });
      } catch (err2) {
        // Fetch failed too — fall back to a fresh mission branch from current HEAD.
        const missionBranch = `mission/${safeName}`;
        await exec('git', ['worktree', 'add', '-b', missionBranch, path], { cwd: repoPath });
      }
    }
    // After creating the worktree on the PR branch, sync it to the latest
    // remote state so the review sees current code even if the branch already
    // existed locally with stale commits.
    await syncWorktreeToBranch(repoPath, path, branch);
    return path;
  }
  const branchName = `mission/${safeName}`;
  // When creating a NEW branch from a base branch (e.g. a fix branch derived
  // from a PR head branch), the new branch must start at the base branch's
  // tip, not the repo's current HEAD. `git worktree add -b <new> <path> <base>`
  // creates the branch from <base>.
  const startPoint = fromBranch ?? undefined;
  try {
    await exec('git', ['worktree', 'add', '-b', branchName, path, ...(startPoint ? [startPoint] : [])], { cwd: repoPath });
  } catch (err) {
    // Branch may already exist from a previous run (e.g. a plan that was
    // interrupted left the branch behind but no registered worktree). Reuse
    // the existing branch instead of failing. If the target directory is a
    // leftover orphan (exists on disk but not registered as a worktree),
    // remove it first so `git worktree add` can proceed.
    try {
      await exec('git', ['worktree', 'add', path, branchName], { cwd: repoPath });
    } catch (err2) {
      // The directory may be an orphan from a crashed run. Clean it and retry.
      await exec('git', ['worktree', 'prune'], { cwd: repoPath });
      await exec('rm', ['-rf', path]);
      await exec('git', ['worktree', 'add', path, branchName], { cwd: repoPath });
    }
  }
  return path;
}

export async function removeWorktree(worktreePath: string): Promise<void> {
  // Resolve the repo from the worktree itself so `git worktree remove` runs in
  // a valid git context regardless of the caller's cwd.
  try {
    await exec('git', ['-C', worktreePath, 'worktree', 'remove', '--force', worktreePath]);
  } catch {
    // Best effort.
  }
}

/**
 * Fetch the latest state of a branch from origin and hard-reset the given
 * worktree to it. Used so a review task always sees the PR's current code,
 * even when the branch already existed locally (or the worktree was reused)
 * with stale commits. Uses FETCH_HEAD to avoid git's "refusing to fetch into
 * a checked-out branch" error when the branch is checked out in another
 * worktree.
 */
async function syncWorktreeToBranch(repoPath: string, worktreePath: string, branch: string): Promise<void> {
  try {
    // Fetch the branch's latest commit into FETCH_HEAD (does not touch any
    // local ref, so it works even if the branch is checked out elsewhere).
    await exec('git', ['-C', repoPath, 'fetch', 'origin', branch], { timeout: 30_000 });
    // Resolve the fetched commit SHA from the main repo (FETCH_HEAD lives in
    // the main repo, not the worktree), then hard-reset the worktree to it.
    const { stdout } = await exec('git', ['-C', repoPath, 'rev-parse', 'FETCH_HEAD'], { timeout: 15_000 });
    const sha = stdout.trim();
    if (!sha) return;
    await exec('git', ['-C', worktreePath, 'reset', '--hard', sha], { timeout: 30_000 });
    // Clean any untracked files that may have been left behind.
    await exec('git', ['-C', worktreePath, 'clean', '-fd'], { timeout: 30_000 });
  } catch {
    // Best effort — if the fetch fails (offline, no remote), leave the
    // worktree as-is rather than breaking the task.
  }
}

export type WorktreeInfo = {
  path: string;
  branch: string | null;
  current: boolean;
};

/** List all worktrees registered in a repo (`git worktree list --porcelain`). */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await exec('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'], { timeout: 5000 });
    const blocks = stdout.split('\n\n').filter(Boolean);
    return blocks.map((b) => {
      const path = b.match(/^worktree (.+)$/m)?.[1] ?? null;
      const branch = b.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null;
      const detached = b.includes('detached');
      const current = b.split('\n')[0] === `worktree ${repoPath}` || b.includes('HEAD');
      return {
        path: path ?? '',
        branch: detached ? '(detached)' : (branch ?? null),
        current,
      };
    }).filter((w) => w.path);
  } catch {
    return [];
  }
}

/** Derive a repo folder name from a clone URL. */
export function deriveRepoNameFromUrl(url: string): string {
  const source = url.replace(/\.git\/?$/, '').replace(/\/$/, '');
  const name = basename(source);
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid repository name derived from URL');
  }
  return name;
}
