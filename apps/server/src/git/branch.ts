import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Get the current git branch of a repo (or null if not a repo / detached). */
export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-C', repoPath, 'branch', '--show-current'], { timeout: 5000 });
    const branch = stdout.trim();
    return branch || null;
  } catch {
    return null;
  }
}

/**
 * List all branches of a repo that matter for task creation — every local
 * branch plus remote-only branches (a branch checked out only in a worktree,
 * or only pushed to origin, is a local/remote branch you may still want to
 * target). Current branch is marked. Returns [] if not a git repo.
 */
export async function listBranches(repoPath: string): Promise<Array<{ name: string; current: boolean }>> {
  try {
    // `git branch -a` lists local + remote-tracking branches. Remote refs are
    // prefixed `remotes/origin/<name>`; we strip that so the UI shows the same
    // branch you'd check out (`origin/<name>` is the actual local ref you work
    // on). Dedupe by name, preferring the local ref when both exist.
    const { stdout } = await exec('git', ['-C', repoPath, 'branch', '-a', '--format=%(refname:short)|%(HEAD)'], { timeout: 8000 });
    const map = new Map<string, boolean>();
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const raw = trimmed.split('|')[0];
      const head = trimmed.split('|')[1] === '*';
      // Normalize: keep local branches as-is, drop the `remotes/` prefix and,
      // for the common `origin/<branch>` case, drop the leading `origin/`.
      let name = raw;
      let local = true;
      if (name.startsWith('remotes/origin/')) {
        name = name.slice('remotes/origin/'.length);
        local = false;
      } else if (name.startsWith('remotes/')) {
        name = name.slice('remotes/'.length);
        local = false;
      }
      if (!name) continue;
      // Prefer the local ref's "current" flag; a remote-only branch is not current.
      const existing = map.get(name);
      if (existing === true) continue;
      map.set(name, local ? head : (map.get(name) ?? false));
    }
    return Array.from(map.entries()).map(([name, current]) => ({ name, current }));
  } catch {
    return [];
  }
}

/**
 * Check out a branch in a repo, creating it from the current HEAD if it does
 * not exist yet. Returns the branch name on success, or null on failure.
 */
export async function checkoutBranch(repoPath: string, branch: string): Promise<string | null> {
  try {
    // If the branch already exists, just check it out.
    const { stdout: branches } = await exec('git', ['-C', repoPath, 'branch', '--list', branch], { timeout: 5000 });
    if (branches.trim()) {
      await exec('git', ['-C', repoPath, 'checkout', branch], { timeout: 10000 });
    } else {
      // Create the branch from the current HEAD and check it out.
      await exec('git', ['-C', repoPath, 'checkout', '-b', branch], { timeout: 10000 });
    }
    return branch;
  } catch {
    return null;
  }
}
