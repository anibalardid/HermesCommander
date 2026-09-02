import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

const exec = promisify(execFile);

export type ScanResult = {
  path: string;
  isGitRepo: boolean;
  isFolder: boolean;
  nestedRepos: Array<{ name: string; path: string }>;
  branch: string | null;
};

async function isGitRepo(path: string): Promise<boolean> {
  try {
    await exec('git', ['-C', path, 'rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

/** Scan a path: is it a git repo, a plain folder, or a folder with nested git repos? */
export async function scanPath(path: string): Promise<ScanResult> {
  const isFolder = (await exec('stat', ['-f', '%HT', path]).catch(() => ({ stdout: '' }))).stdout.trim() === 'Directory';
  const git = await isGitRepo(path);
  if (git) {
    const { getCurrentBranch } = await import('./branch.js');
    const branch = await getCurrentBranch(path).catch(() => null);
    return { path, isGitRepo: true, isFolder: true, nestedRepos: [], branch };
  }

  let nestedRepos: Array<{ name: string; path: string }> = [];
  if (isFolder) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const sub = join(path, entry.name);
        if (await isGitRepo(sub)) nestedRepos.push({ name: entry.name, path: sub });
      }
    } catch {
      nestedRepos = [];
    }
  }
  return { path, isGitRepo: git, isFolder, nestedRepos, branch: null };
}

export { isGitRepo };
export { basename };
