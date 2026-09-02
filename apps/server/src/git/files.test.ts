import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFiles, readFileContent } from './files.js';
import type { FileEntry } from './files.js';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'hermes-commander-files-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'README.md'), '# hi');
  writeFileSync(join(root, 'src', 'index.ts'), 'console.log(1)');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('git/files — file browser', () => {
  it('lists dirs first then files, alphabetically, skipping ignored dirs', async () => {
    const entries: FileEntry[] = await listFiles(root);
    const names = entries.map((e) => e.name);
    expect(names).toContain('src');
    expect(names).toContain('README.md');
    // node_modules is ignored.
    expect(names).not.toContain('node_modules');
    // dirs come before files.
    expect(entries[0].type).toBe('dir');
  });

  it('lists a subdirectory', async () => {
    const entries: FileEntry[] = await listFiles(root, 'src');
    expect(entries.map((e) => e.name)).toEqual(['index.ts']);
    expect(entries[0].path).toBe('src/index.ts');
  });

  it('rejects paths that escape the root (traversal)', async () => {
    await expect(listFiles(root, '../..')).rejects.toThrow(/escapes/i);
  });

  it('normalizes a leading-slash path to be root-relative (contained)', async () => {
    // A leading slash is stripped, so it stays inside root.
    const entries: FileEntry[] = await listFiles(root, '/src');
    expect(entries.map((e) => e.name)).toEqual(['index.ts']);
  });

  it('reads file content', async () => {
    const r = await readFileContent(root, 'src/index.ts');
    expect(r?.content).toBe('console.log(1)');
    expect(r?.truncated).toBe(false);
  });
});
