import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import the parser — it's not exported, so test via the module indirectly.
// We re-declare the logic here to keep the test hermetic and fast.
import { getSourceStatus } from './status.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

describe('getSourceStatus porcelain parsing', () => {
  let dir: string;
  const run = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hermes-commander-status-'));
    run(['init', '-q']);
    run(['config', 'user.email', 't@t.t']);
    run(['config', 'user.name', 'Test']);
    writeFileSync(join(dir, 'a.txt'), 'hi\n');
    run(['add', 'a.txt']);
    run(['commit', '-m', 'init']);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses a modified file', async () => {
    writeFileSync(join(dir, 'a.txt'), 'changed\n');
    const s = await getSourceStatus(dir, null);
    expect(s.files).toContainEqual({ path: 'a.txt', code: 'M', staged: false });
  });

  it('parses an untracked file', async () => {
    writeFileSync(join(dir, 'new.md'), 'new\n');
    const s = await getSourceStatus(dir, null);
    expect(s.files).toContainEqual({ path: 'new.md', code: '??', staged: false });
  });

  it('parses a staged (added) file', async () => {
    writeFileSync(join(dir, 'b.txt'), 'x\n');
    run(['add', 'b.txt']);
    const s = await getSourceStatus(dir, null);
    expect(s.files).toContainEqual({ path: 'b.txt', code: 'A', staged: true });
  });
});
