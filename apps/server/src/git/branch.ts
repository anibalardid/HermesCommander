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
 * List all local branches of a repo (current branch marked). Returns [] if not
 * a git repo.
 */
export async function listBranches(repoPath: string): Promise<Array<{ name: string; current: boolean }>> {
  try {
    const { stdout } = await exec('git', ['-C', repoPath, 'branch', '--format=%(refname:short)|%(HEAD)'], { timeout: 5000 });
    return stdout.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, head] = line.split('|');
        return { name, current: head === '*' };
      });
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
