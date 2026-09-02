import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';

export type FileEntry = {
  name: string;
  path: string;        // relative to root
  type: 'file' | 'dir';
  size: number;        // bytes (0 for dirs)
  protected?: boolean; // true for .git and anything inside it (not editable/deletable)
};

/** Directories to skip when listing the workspace tree (noise, not hidden). */
const IGNORED = new Set(['node_modules', 'dist', '.next', 'coverage', '.cache']);

/** True if the relative path is inside the .git directory (protected). */
function isGitInternal(rel: string): boolean {
  return rel === '.git' || rel.startsWith('.git/') || rel.startsWith('.git\\');
}

/** Resolve a safe absolute path under root, rejecting any path that escapes it. */
function safeResolve(root: string, relPath: string): { abs: string; rel: string } {
  // Normalize relPath to be root-relative; strip any leading separators.
  const clean = relPath.replace(/^[/\\]+/, '');
  const abs = resolve(root, clean);
  const rel = relative(resolve(root), abs);
  // Reject if the resolved path walks out of root (..) or is the root itself when a subpath was requested.
  if (rel.startsWith('..') || (clean && rel === '')) {
    throw new Error('Path escapes the project directory');
  }
  return { abs, rel };
}

/** List the immediate children of a directory under root. relPath '' = root. */
export async function listFiles(root: string, relPath = ''): Promise<FileEntry[]> {
  const { abs, rel } = safeResolve(root, relPath);
  const st = await stat(abs);
  if (!st.isDirectory()) throw new Error('Not a directory');
  const entries = await readdir(abs, { withFileTypes: true });
  const out: FileEntry[] = [];
  for (const e of entries) {
    if (IGNORED.has(e.name)) continue;
    const childAbs = join(abs, e.name);
    const childRel = rel ? `${rel}${sep}${e.name}` : e.name;
    const protected_ = isGitInternal(childRel);
    if (e.isDirectory()) {
      out.push({ name: e.name, path: childRel, type: 'dir', size: 0, protected: protected_ });
    } else if (e.isFile()) {
      let size = 0;
      try { size = (await stat(childAbs)).size; } catch { /* ignore */ }
      out.push({ name: e.name, path: childRel, type: 'file', size, protected: protected_ });
    }
  }
  // Directories first, then files — both alphabetical.
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

const MAX_TEXT_BYTES = 200 * 1024; // 200KB cap for text previews

/** Read a file's text content under root (bounded). Returns null if binary/too large. */
export async function readFileContent(root: string, relPath: string): Promise<{ content: string; truncated: boolean } | null> {
  const { abs } = safeResolve(root, relPath);
  const st = await stat(abs);
  if (!st.isFile()) return null;
  if (st.size > MAX_TEXT_BYTES) return { content: '', truncated: true };
  const buf = await readFile(abs);
  // Heuristic: if it contains a NUL byte it's binary.
  if (buf.includes(0)) return null;
  return { content: buf.toString('utf8'), truncated: false };
}

/** Write a file's text content under root (bounded). Rejects if it escapes root or is inside .git. */
export async function writeFileContent(root: string, relPath: string, content: string): Promise<void> {
  const { abs, rel } = safeResolve(root, relPath);
  // .git and everything inside it is read-only from the UI.
  if (isGitInternal(rel)) throw new Error('Cannot modify files inside .git');
  // Ensure the target is a file (or will be created) and text-sized.
  const st = await stat(abs).catch(() => null);
  if (st && st.size > MAX_TEXT_BYTES) throw new Error('File too large to save');
  if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) throw new Error('Content too large to save');
  await writeFile(abs, content, 'utf8');
}
