import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createWorktree, removeWorktree, deriveRepoNameFromUrl } from './worktree.js';

let repoDir: string;
let worktreePath: string;

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'hermes-commander-git-'));
  execFileSync('git', ['init', '-q', repoDir]);
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@test.com']);
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-m', 'init']);
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('git worktree', () => {
  it('creates an isolated worktree with a mission branch', async () => {
    worktreePath = await createWorktree(repoDir, 'Fix Auth Flow');
    expect(existsSync(worktreePath)).toBe(true);
    // The worktree should be a git repo with a mission branch.
    const branch = execFileSync('git', ['-C', worktreePath, 'branch', '--show-current']).toString().trim();
    expect(branch).toMatch(/^mission\//);
  });

  it('removes the worktree', async () => {
    await removeWorktree(worktreePath);
    expect(existsSync(worktreePath)).toBe(false);
  });

  it('recovers when the branch exists but the worktree dir is an orphan', async () => {
    // Simulate a crashed previous run: create the mission branch but leave an
    // orphan directory on disk that is NOT registered as a worktree.
    const orphanName = 'Orphan Recovery';
    const orphanBranch = 'mission/orphan-recovery';
    const orphanPath = join(dirname(repoDir), '.hermes-commander-wt', 'orphan-recovery');
    execFileSync('git', ['-C', repoDir, 'branch', orphanBranch]);
    // Create a stale directory that looks like a leftover worktree.
    execFileSync('mkdir', ['-p', orphanPath]);
    execFileSync('git', ['-C', orphanPath, 'init', '-q']);

    // createWorktree must recover: reuse the existing branch and clean the
    // orphan dir, rather than throwing.
    const recovered = await createWorktree(repoDir, orphanName);
    expect(existsSync(recovered)).toBe(true);
    const branch = execFileSync('git', ['-C', recovered, 'branch', '--show-current']).toString().trim();
    expect(branch).toBe(orphanBranch);
    await removeWorktree(recovered);
  });

  it('trims trailing dots/dashes from the branch name (git rejects them)', async () => {
    // A task title ending in "." would produce a branch like
    // "mission/agregar-efectos--animaciones." which git rejects. The derived
    // branch must have the trailing dot trimmed so `git worktree add` succeeds.
    const wt = await createWorktree(repoDir, 'Agregar efectos y notificaciones.');
    const branch = execFileSync('git', ['-C', wt, 'branch', '--show-current']).toString().trim();
    expect(branch).not.toMatch(/\.$/);
    expect(branch).toMatch(/^mission\//);
    await removeWorktree(wt);
  });
});

describe('deriveRepoNameFromUrl', () => {
  it('derives repo name from a git URL', () => {
    expect(deriveRepoNameFromUrl('git@github.com:owner/my-repo.git')).toBe('my-repo');
    expect(deriveRepoNameFromUrl('https://github.com/owner/repo')).toBe('repo');
  });

  it('rejects invalid names', () => {
    // A URL whose last segment is a dot or empty should throw.
    expect(() => deriveRepoNameFromUrl('https://github.com/owner/.')).toThrow();
  });
});
