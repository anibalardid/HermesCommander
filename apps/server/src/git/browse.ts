import { readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type FsEntry = {
  name: string;
  path: string; // absolute
  type: 'dir' | 'file';
  isGitRepo?: boolean;
  /** Current branch of a git repo (or worktree). Populated when isGitRepo. */
  branch?: string | null;
};

/** Directories to skip when browsing (noise). */
const IGNORED = new Set(['node_modules', 'dist', '.next', 'coverage', '.cache', '.git', 'Library', 'Applications']);

/** Default starting points for the browser. */
export function defaultRoots(): string[] {
  const home = homedir();
  return [home, join(home, 'Projects'), join(home, 'Sites'), join(home, 'Desktop'), join(home, 'Documents')];
}

/** List the immediate children of a directory (dirs + git repos). */
export async function browseDir(absPath: string): Promise<{ path: string; entries: FsEntry[] }> {
  const st = await stat(absPath).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error('Not a directory');
  const entries = await readdir(absPath, { withFileTypes: true });
  const out: FsEntry[] = [];
  for (const e of entries) {
    if (IGNORED.has(e.name)) continue;
    if (e.name.startsWith('.')) continue; // skip hidden
    const childAbs = join(absPath, e.name);
    // For symlinks, dirent.isDirectory()/isFile() are false. stat() follows the
    // link, so we classify symlinks to dirs as dirs (and files as files).
    const isLink = e.isSymbolicLink();
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (isLink) {
      try {
        const tgt = await stat(childAbs);
        isDir = tgt.isDirectory();
        isFile = tgt.isFile();
      } catch { /* broken link — skip */ continue; }
    }
    if (!isDir && !isFile) continue; // sockets, fifos, etc.
    if (isDir) {
      let isGitRepo = false;
      let branch: string | null = null;
      try { isGitRepo = (await stat(join(childAbs, '.git'))).isDirectory(); } catch { /* not a repo */ }
      if (isGitRepo) {
        try {
          const { stdout } = await exec('git', ['-C', childAbs, 'branch', '--show-current'], { timeout: 5000 });
          branch = stdout.trim() || null;
        } catch { branch = null; }
      }
      out.push({ name: e.name, path: childAbs, type: 'dir', isGitRepo, branch });
    } else {
      out.push({ name: e.name, path: childAbs, type: 'file' });
    }
  }
  // Directories first, then files — both alphabetical.
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: absPath, entries: out };
}

/** Resolve a path for browsing. Empty → home. */
export function resolveBrowsePath(p: string | undefined): string {
  if (!p || !p.trim()) return homedir();
  return resolve(p.trim());
}
