import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { isGhAvailable } from './status.js';

const exec = promisify(execFile);

/** A PR summary as exposed to the mobile/desktop Tasks page. */
export type GithubPr = {
  projectId: string;
  projectName: string;
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED' | 'DRAFT';
  branch: string | null;
  base: string | null;
  url: string;
  author: string | null;
  updatedAt: string | null;
  additions: number | null;
  deletions: number | null;
  mergeable: string | null;
};

/** A review comment thread item. */
export type PrComment = {
  id: string;
  author: string;
  body: string;
  createdAt: string | null;
  path: string | null;
  isStale: boolean | null;
};

/** A single user/reviewer reference (login + avatar for review UI). */
export type PrReviewer = {
  login: string;
  state: string | null;   // APPROVED | CHANGES_REQUESTED | COMMENTED | null (if just requested)
  avatar: string | null;
};
export type PrAssignee = {
  login: string;
  avatar: string | null;
};
export type PrFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

/** A comment thread: top-level issue comments are their own thread; inline
 *  review comments on the same path group into one thread. Replies live on the
 *  same thread. */
export type PrCommentThread = {
  id: string;
  path: string | null;
  isResolved: boolean | null;
  comments: PrComment[];
};

/** Full detail for a single PR (used by the detail page). */
export type GithubPrDetail = GithubPr & {
  body: string;
  comments: PrComment[];
  commentThreads: PrCommentThread[];
  reviewers: PrReviewer[];
  assignees: PrAssignee[];
  files: PrFile[];
};

/** Map an `gh` PR state token to our normalized union. */
function normState(s?: string): GithubPr['state'] {
  switch (s?.toLowerCase()) {
    case 'merged': return 'MERGED';
    case 'closed': return 'CLOSED';
    case 'draft': return 'DRAFT';
    case 'open':
    default: return 'OPEN';
  }
}

async function gh(args: string[], cwd: string, timeout = 15000): Promise<any> {
  const { stdout } = await exec('gh', args, { cwd, timeout });
  return JSON.parse(stdout);
}

/** Run `gh` and return raw stdout (no JSON parsing). */
async function execGh(sub: 'pr' | 'api', args: string[], cwd: string, timeout = 20000): Promise<string> {
  const { stdout } = await exec('gh', [sub, ...args], { cwd, timeout });
  return stdout.trim();
}

/** List all items from a `gh api` paginated endpoint. `{owner}/{repo}` is
 *  resolved from the local repo by gh. Adds --paginate so we get every page. */
async function ghApiList(endpoint: string, cwd: string, timeout = 20000): Promise<any[]> {
  const { stdout } = await exec('gh', ['api', endpoint, '--paginate'], { cwd, timeout });
  // gh api returns one JSON array per page; concatenate them.
  const out: any[] = [];
  for (const chunk of stdout.split('\n').filter((s) => s.trim().length > 0)) {
    const parsed = JSON.parse(chunk);
    if (Array.isArray(parsed)) out.push(...parsed);
  }
  return out;
}

/** GitHub account owners the user can create repos under: their user + orgs. */
export async function listOwners(): Promise<{ user: string | null; orgs: string[] }> {
  const avail = await isGhAvailable();
  if (!avail) return { user: null, orgs: [] };
  let user: string | null = null;
  try {
    const { stdout } = await exec('gh', ['api', 'user', '--jq', '.login'], { timeout: 10000 });
    user = stdout.trim() || null;
  } catch { /* not authed */ }
  let orgs: string[] = [];
  try {
    const { stdout } = await exec('gh', ['api', 'orgs', '--jq', '.[].login'], { timeout: 10000 });
    orgs = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { /* no orgs */ }
  return { user, orgs };
}

/**
 * List PRs across every git project in one pass. Requires `gh` authenticated.
 * Non-git projects and repos without `gh` are skipped silently.
 */
export async function listAllPrs(projects: Array<{ id: string; name: string; path?: string | null }>): Promise<GithubPr[]> {
  const ghAvail = await isGhAvailable();
  if (!ghAvail) return [];
  const out: GithubPr[] = [];
  for (const p of projects) {
    if (!p.path) continue;
    try {
      await exec('git', ['-C', p.path, 'rev-parse', '--show-toplevel'], { timeout: 5000 });
    } catch {
      continue; // not a git repo
    }
    let items: any[] = [];
    try {
      items = await gh(
        ['pr', 'list', '--json', 'number,title,state,headRefName,baseRefName,url,author,updatedAt,additions,deletions,mergeable', '--limit', '100'],
        p.path
      );
    } catch {
      continue;
    }
    for (const i of items) {
      out.push({
        projectId: p.id,
        projectName: p.name,
        number: i.number,
        title: i.title,
        state: normState(i.state),
        branch: i.headRefName ?? null,
        base: i.baseRefName ?? null,
        url: i.url ?? '',
        author: i.author?.login ?? null,
        updatedAt: i.updatedAt ?? null,
        additions: i.additions ?? null,
        deletions: i.deletions ?? null,
        mergeable: i.mergeable ?? null,
      });
    }
  }
  return out;
}

/** Fetch full detail + review comments for a single PR. */
export async function getPrDetail(repoPath: string, number: number): Promise<Omit<GithubPrDetail, 'projectId' | 'projectName'>> {
  const d = await gh(
    ['pr', 'view', String(number), '--json', 'number,title,state,headRefName,baseRefName,url,author,updatedAt,additions,deletions,mergeable,body,reviews,comments,reviewRequests,assignees'],
    repoPath
  );

  // Reviewers: the set of users who reviewed plus those requested, deduped.
  const reviewerMap = new Map<string, PrReviewer>();
  for (const r of d.reviewRequests ?? []) {
    const login = r.requestedReviewer?.login ?? null;
    if (login) reviewerMap.set(login, { login, state: null, avatar: r.requestedReviewer?.avatarUrl ?? null });
  }
  for (const r of d.reviews ?? []) {
    const login = r.author?.login ?? null;
    if (login) {
      const st = (r.state ?? '').toUpperCase();
      const state = st === 'APPROVED' || st === 'CHANGES_REQUESTED' || st === 'COMMENTED' ? st : null;
      const prev = reviewerMap.get(login);
      // A submitted review updates the state; a bare request keeps null.
      reviewerMap.set(login, { login, state: state ?? prev?.state ?? null, avatar: prev?.avatar ?? r.author?.avatarUrl ?? null });
    }
  }
  const reviewers = [...reviewerMap.values()];
  const assignees: PrAssignee[] = (d.assignees ?? []).map((a: any) => ({
    login: a.login ?? 'unknown',
    avatar: a.avatarUrl ?? null,
  }));

  // Inline review comments: group by path (each path+comment thread is a thread).
  // `gh pr view --json comments` gives issue-level comments; for positional
  // thread comments we query the API so we get paths and in-reply-to nesting.
  const inline: PrComment[] = [];
  try {
    const inlineRaw = await ghApiList(`repos/{owner}/{repo}/pulls/${number}/comments`, repoPath);
    for (const c of inlineRaw) {
      inline.push({
        id: String(c.id),
        author: c.user?.login ?? 'unknown',
        body: c.body ?? '',
        createdAt: c.created_at ?? null,
        path: c.path ?? null,
        isStale: c.in_reply_to_id ? false : (c.position === null && c.line === null ? true : false),
      });
    }
  } catch { /* no inline comments */ }

  // Issue-level (non-positional) comments.
  const issueComments: PrComment[] = (d.comments ?? []).map((c: any, i: number) => ({
    id: String(c.id ?? c.url ?? i),
    author: c.author?.login ?? 'unknown',
    body: c.body ?? '',
    createdAt: c.createdAt ?? null,
    path: null,
    isStale: null,
  }));

  // Group into threads: issue comments share a top-level thread (path=null).
  // Inline comments group by path. Preserve chronological order within a thread.
  const threads = new Map<string, PrCommentThread>();
  const topThread: PrCommentThread = { id: 'conversation', path: null, isResolved: null, comments: [] };
  threads.set('conversation', topThread);
  const ordered: PrComment[] = [...issueComments, ...inline].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  for (const c of ordered) {
    const key = c.path ? `file:${c.path}` : 'conversation';
    const t = threads.get(key) ?? { id: key, path: c.path, isResolved: null, comments: [] };
    t.comments.push(c);
    threads.set(key, t);
  }
  const commentThreads = [...threads.values()]
    .filter((t) => t.comments.length > 0)
    .sort((a, b) => (a.path ? 1 : -1) - (b.path ? 1 : -1)); // conversation first

  // Files changed: use the GitHub API for real status + per-file line counts.
  let files: PrFile[] = [];
  try {
    const filesRaw = await ghApiList(`repos/{owner}/{repo}/pulls/${number}/files`, repoPath);
    files = filesRaw.map((f) => ({
      path: f.filename ?? f.path ?? '',
      status: f.status ?? 'modified',
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
    })).filter((f) => f.path);
  } catch { /* ignore */ }

  return {
    number: d.number,
    title: d.title,
    state: normState(d.state),
    branch: d.headRefName ?? null,
    base: d.baseRefName ?? null,
    url: d.url ?? '',
    author: d.author?.login ?? null,
    updatedAt: d.updatedAt ?? null,
    additions: d.additions ?? null,
    deletions: d.deletions ?? null,
    mergeable: d.mergeable ?? null,
    body: d.body ?? '',
    comments: ordered,
    commentThreads,
    reviewers,
    assignees,
    files,
  };
}

/** Merge a PR. `method`: merge | squash | rebase. `deleteLocal`: also delete the local branch after merging. */
export async function mergePr(repoPath: string, number: number, method: string, deleteLocal = false): Promise<void> {
  // Merge WITHOUT --delete-branch: gh's --delete-branch fails when the branch
  // is checked out in a worktree ("cannot delete branch used by worktree").
  // We delete the local branch ourselves with git, after removing any worktree
  // that has it checked out.
  const { stdout } = await exec('gh', ['pr', 'merge', String(number), '--' + method], { cwd: repoPath, timeout: 30000 });
  if (stdout.includes('failed') || stdout.toLowerCase().includes('error')) {
    throw new Error(stdout.trim());
  }
  if (deleteLocal) {
    // Delete the local branch (and its remote-tracking ref) if it exists and
    // isn't the current branch. Safe to ignore errors (branch may not exist locally).
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    try {
      const { stdout: branchOut } = await exec('git', ['-C', repoPath, 'branch', '--show-current'], { timeout: 5000 });
      const current = branchOut.trim();
      const { stdout: headOut } = await exec('gh', ['pr', 'view', String(number), '--json', 'headRefName', '--jq', '.headRefName'], { cwd: repoPath, timeout: 15000 });
      const head = headOut.trim();
      if (head && head !== current) {
        // Remove any worktree that has this branch checked out — git refuses
        // to delete a branch that is checked out in a worktree. Run from the
        // MAIN repo (not the worktree) and don't swallow failures silently.
        const { stdout: wtOut } = await exec('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'], { timeout: 5000 });
        const blocks = wtOut.split('\n\n').filter(Boolean);
        for (const block of blocks) {
          const wtPath = block.match(/^worktree (.+)$/m)?.[1];
          const wtBranch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
          if (wtPath && wtBranch === head) {
            await exec('git', ['-C', repoPath, 'worktree', 'remove', '--force', wtPath], { timeout: 10000 });
          }
        }
        await exec('git', ['-C', repoPath, 'branch', '-D', head], { timeout: 10000 });
        await exec('git', ['-C', repoPath, 'branch', '-dr', `origin/${head}`], { timeout: 10000 }).catch(() => {});
      }
    } catch { /* ignore */ }
  }
}

/** Close (or reopen) a PR. */
export async function setPrState(repoPath: string, number: number, closed: boolean): Promise<void> {
  await exec('gh', ['pr', closed ? 'close' : 'reopen', String(number)], { cwd: repoPath, timeout: 30000 });
}

/** Post a top-level comment on a PR. Returns the new comment id. */
export async function addPrComment(repoPath: string, number: number, body: string): Promise<void> {
  await exec('gh', ['pr', 'comment', String(number), '--body', body], { cwd: repoPath, timeout: 30000 });
}

/** Fetch the full unified diff of a PR (for the Files changed tab + task PR modal). */
export async function getPrDiff(repoPath: string, number: number): Promise<string> {
  return execGh('pr', ['diff', String(number)], repoPath);
}

/**
 * Create an isolated worktree checked out on the PR's head branch.
 * The worktree lives one level above the repo so it doesn't
 * pollute the repo's own working tree. Returns the worktree path.
 */
export async function createWorktreeFromPr(repoPath: string, number: number, branch: string): Promise<string> {
  // If the branch is already checked out in an existing worktree, reuse it
  // instead of creating a duplicate (git refuses to fetch/checkout a branch
  // that is already checked out in another worktree).
  try {
    const { stdout } = await exec('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'], { cwd: repoPath, timeout: 15000 });
    const blocks = stdout.split('\n\n');
    for (const block of blocks) {
      const pathMatch = block.match(/^worktree (.+)$/m);
      const headMatch = block.match(/^HEAD ([0-9a-f]+)$/m);
      const branchMatch = block.match(/^branch refs\/heads\/(.+)$/m);
      if (pathMatch && branchMatch && branchMatch[1] === branch) {
        return pathMatch[1].trim();
      }
      // Also match detached HEAD pointing at the branch's commit.
      if (pathMatch && headMatch && !branchMatch) {
        const { stdout: headOut } = await exec('git', ['-C', repoPath, 'rev-parse', `refs/heads/${branch}`], { cwd: repoPath, timeout: 15000 });
        if (headOut.trim() === headMatch[1]) return pathMatch[1].trim();
      }
    }
  } catch {
    // fall through to normal creation
  }

  // Ensure the branch exists locally (fetch the PR head), then create a worktree
  // checked out on that branch. Branch name may be e.g. "feature/x"; sanitize.
  const safeName = `pr-${number}-${branch.replace(/[^a-zA-Z0-9._-]/g, '-')}`.slice(0, 80);
  const parent = dirname(repoPath);
  const root = join(parent, '.hermes-commander-wt');
  mkdirSync(root, { recursive: true });
  const path = join(root, safeName);
  try {
    // Worktree on the existing PR head branch (create it first if needed via fetch).
    await exec('git', ['-C', repoPath, 'worktree', 'add', path, branch], { cwd: repoPath, timeout: 30000 });
  } catch {
    // Branch might not exist locally yet — fetch it first, then retry.
    await exec('git', ['-C', repoPath, 'fetch', 'origin', `${branch}:refs/heads/${branch}`], { timeout: 30000 });
    await exec('git', ['-C', repoPath, 'worktree', 'add', path, branch], { cwd: repoPath, timeout: 30000 });
  }
  return path;
}
