import type { FastifyInstance } from 'fastify';
import type { Store } from '../db/store.js';
import type { EventHub } from '../runner/ws.js';
import { scanPath, type ScanResult } from '../git/scan.js';
import { searchPrompts } from './promptlibrary.js';
import { notify } from '../notifications.js';
import { existsSync } from 'node:fs';

/** Project, mission, task and agent-config REST routes. See docs/05-api.md. */
export function registerApiRoutes(app: FastifyInstance, store: Store, hub: EventHub): void {
  // ---- Projects ----
  app.get('/api/projects', async () => {
    const projects = store.listProjects();
    // Attach the current git branch + remote URL for git projects.
    const { getCurrentBranch } = await import('../git/branch.js');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const withBranch = await Promise.all(projects.map(async (p) => {
      if (p.type !== 'git') return p;
      const branch = await getCurrentBranch(p.path).catch(() => null);
      let remoteUrl: string | null = p.remote_url;
      if (!remoteUrl) {
        try {
          const { stdout } = await exec('git', ['-C', p.path, 'remote', 'get-url', 'origin'], { timeout: 5000 });
          remoteUrl = stdout.trim() || null;
        } catch { /* no remote */ }
      }
      return { ...p, branch, remote_url: remoteUrl };
    }));
    return { projects: withBranch };
  });

  /** Global search across projects, missions, and tasks (Ctrl+K palette). */
  app.get('/api/search', async (req) => {
    const { q } = req.query as { q?: string };
    if (!q || !q.trim()) return { projects: [], missions: [], tasks: [] };
    return store.searchAll(q);
  });

  // ---- Subagent recipes (templates) ----
  app.get('/api/recipes', async () => ({ recipes: store.listRecipes() }));
  app.post('/api/recipes', async (req) => {
    const b = req.body as Record<string, unknown>;
    const recipe = store.createRecipe({
      name: b.name as string,
      title: b.title as string,
      description: b.description as string,
      system_prompt: b.system_prompt as string,
      profile: (b.profile as string) ?? null,
      provider: (b.provider as string) ?? null,
      model: (b.model as string) ?? null,
      is_default: b.is_default ? 1 : 0,
    });
    return { recipe };
  });
  app.patch('/api/recipes/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = req.body as Record<string, unknown>;
    const recipe = store.updateRecipe(id, {
      ...(b.title !== undefined ? { title: b.title as string } : {}),
      ...(b.description !== undefined ? { description: b.description as string } : {}),
      ...(b.system_prompt !== undefined ? { system_prompt: b.system_prompt as string } : {}),
      ...(b.profile !== undefined ? { profile: (b.profile as string) || null } : {}),
      ...(b.provider !== undefined ? { provider: (b.provider as string) || null } : {}),
      ...(b.model !== undefined ? { model: (b.model as string) || null } : {}),
      ...(b.is_default !== undefined ? { is_default: b.is_default ? 1 : 0 } : {}),
    });
    return { recipe };
  });
  app.delete('/api/recipes/:id', async (req) => {
    const { id } = req.params as { id: string };
    store.deleteRecipe(id);
    return { ok: true };
  });

  // ---- Dev prompt library (proxy + 1h cache) ----
  app.get('/api/prompts', async (req, reply) => {
    const { q } = req.query as { q?: string };
    try {
      const { prompts, total } = await searchPrompts({ q });
      return { prompts, total };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.post('/api/projects', async (req) => {
    const body = req.body as {
      action: 'open' | 'create' | 'clone' | 'group';
      path?: string; newPath?: string; cloneUrl?: string; destination?: string;
      name?: string; projectIds?: string[]; groupName?: string; setupScript?: string;
      github?: 'none' | 'private' | 'public';
      owner?: string | null;
    };
    if (body.action === 'clone' && body.cloneUrl && body.destination) {
      // Clone handled by git layer.
      const { cloneRepo } = await import('../git/clone.js');
      return cloneRepo(store, hub, body.cloneUrl, body.destination);
    }
    // A brand-new repo: git init + optional GitHub (private/public).
    if (body.action === 'create' && body.newPath) {
      const { createNewRepo } = await import('../git/create-repo.js');
      const name = body.name ?? body.newPath.split(/[\\/]/).pop() ?? 'Project';
      return createNewRepo(store, hub, {
        path: body.newPath,
        name,
        github: body.github ?? 'none',
        owner: body.owner ?? null,
      });
    }
    // open / group register an existing path as a project.
    const path = body.path ?? body.newPath;
    if (path) {
      const { validateProjectPath } = await import('../git/pathguard.js');
      const guardErr = validateProjectPath(path);
      if (guardErr) {
        return { error: guardErr };
      }
    }
    const name = body.name ?? (path?.split(/[\\/]/).pop() ?? 'Project');
    const isGit = await isGitRepo(path ?? '');
    const project = store.createProject({
      name, path: path ?? '', type: isGit ? 'git' : 'folder',
      remote_url: null, created_by: body.action as 'open' | 'create' | 'clone',
      badge_color: null, parent_group: null, setup_script: body.setupScript ?? null,
    });
    hub.emit('office', null, 'project_created', { id: project.id });
    return project;
  });

  /** Update a project (name, setup script, etc.). */
  app.patch('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const project = store.updateProject(id, {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.setupScript !== undefined ? { setup_script: String(body.setupScript) } : {}),
      ...(body.description !== undefined ? { description: body.description ? String(body.description) : null } : {}),
    });
    return project;
  });

  app.post('/api/projects/scan', async (req) => {
    const { path } = req.body as { path: string };
    const result: ScanResult = await scanPath(path);
    return result;
  });

  /**
   * Open the native folder picker (Finder on macOS, zenity on Linux) and return
   * the selected path. Mirrors the "Explore folder" flow.
   */
  app.post('/api/projects/pick-folder', async (_req, reply) => {
    const { pickFolder } = await import('../git/pick-folder.js');
    const path = await pickFolder();
    if (!path) return reply.code(400).send({ error: 'no folder selected' });
    return { path };
  });

  // ---- Filesystem browser (mobile-friendly folder picker) ----
  app.get('/api/fs/browse', async (req, reply) => {
    const { path } = req.query as { path?: string };
    const { browseDir, resolveBrowsePath, defaultRoots } = await import('../git/browse.js');
    try {
      const abs = resolveBrowsePath(path);
      const { path: listed, entries } = await browseDir(abs);
      return { path: listed, entries, roots: defaultRoots() };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // Create a new folder under a given parent. Used by the folder picker so a
  // user can create a fresh directory for a new project without leaving the UI.
  app.post('/api/fs/mkdir', async (req, reply) => {
    const { parent, name } = req.body as { parent?: string; name?: string };
    if (!parent || !name || !name.trim()) {
      return reply.code(400).send({ error: 'parent and name are required' });
    }
    // Reject unsafe roots and names that would escape the parent.
    const { validateProjectPath } = await import('../git/pathguard.js');
    const { join } = await import('node:path');
    const target = join(parent, name.trim());
    if (validateProjectPath(target)) {
      return reply.code(400).send({ error: 'Invalid path' });
    }
    if (name.includes('/') || name.includes('\\') || /^\.+$/.test(name.trim()) || /\.\./.test(name.trim())) {
      return reply.code(400).send({ error: 'Invalid folder name' });
    }
    try {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(target, { recursive: false });
      return { path: target };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- GitHub owners (user + orgs) for creating repos ----
  app.get('/api/github/owners', async () => {
    const { listOwners } = await import('../git/github.js');
    return listOwners();
  });

  app.delete('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    store.deleteProject(id);
    return { ok: true };
  });

  // ---- Missions ----
  app.get('/api/missions', async (req) => {
    const q = req.query as { projectId?: string };
    return { missions: store.listMissions(q.projectId) };
  });

  // Task-state counts per mission for a project — used by the project view to
  // render a colored counter (todo/doing/blocked/done) next to each mission.
  app.get('/api/projects/:id/mission-stats', async (req) => {
    const { id } = req.params as { id: string };
    const missions = store.listMissions(id);
    const stats: Record<string, Record<string, number>> = {};
    for (const m of missions) stats[m.id] = store.countTasksByState(m.id);
    return { stats };
  });

  app.post('/api/missions', async (req) => {
    const body = req.body as Record<string, any>;
    const mission = store.createMission({
      project_id: String(body.projectId),
      name: String(body.name),
      objective: String(body.objective),
      git_strategy: (body.gitStrategy as 'worktree' | 'branch' | 'none') ?? 'none',
      base_branch: (body.baseBranch as string) ?? null,
      worktree_path: null,
      driver_type: String(body.driver?.type ?? 'hermes'),
      driver_profile: (body.driver?.profile as string) ?? null,
      driver_model: String(body.driver?.model ?? 'deepseek-v4-flash:cloud'),
      driver_provider: (body.driver?.provider as string) ?? null,
      driver_worktree_flag: (body.driver?.worktreeFlag as boolean) ? 1 : 0,
      uses_kanban: (body.usesKanban as boolean) !== false ? 1 : 0,
      intervention: (body.intervention as 'autonomous' | 'approve-steps' | 'manual') ?? 'autonomous',
      depends_on_mission_ids: JSON.stringify((body.dependsOnMissionIds as string[]) ?? []),
      max_concurrent: (body.maxConcurrent as number | undefined) ?? null,
      state: 'pending', session_id: null, started_at: null, finished_at: null,
    });
    return mission;
  });

  app.get('/api/missions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const mission = store.getMission(id);
    if (!mission) return { error: 'mission not found' };
    // Attach the current branch (worktree branch if a worktree exists, else the
    // project's branch) so the UI can show it.
    let branch: string | null = null;
    const { getCurrentBranch } = await import('../git/branch.js');
    if (mission.worktree_path) {
      branch = await getCurrentBranch(mission.worktree_path).catch(() => null);
    } else {
      const proj = store.getProject(mission.project_id);
      if (proj?.type === 'git') branch = await getCurrentBranch(proj.path).catch(() => null);
    }
    return { mission: { ...mission, branch }, tasks: store.listTasks(id), runs: store.listRunsForMission(id) };
  });

  // List the branches available on the mission's project repo, so the user can
  // pick an existing branch or type a new one when creating a task.
  app.get('/api/missions/:id/branches', async (req, reply) => {
    const { id } = req.params as { id: string };
    const mission = store.getMission(id);
    if (!mission) return reply.code(404).send({ error: 'mission not found' });
    const proj = store.getProject(mission.project_id);
    if (!proj || proj.type !== 'git') return { branches: [] };
    const { listBranches } = await import('../git/branch.js');
    const branches = await listBranches(proj.path).catch(() => []);
    return { branches };
  });

  /** Resolve the working dir for a mission: its worktree path, else the project path. */
  function missionWorkDir(missionId: string): string | null {
    const m = store.getMission(missionId);
    if (!m) return null;
    if (m.worktree_path?.trim()) return m.worktree_path;
    const proj = store.getProject(m.project_id);
    return proj?.path ?? null;
  }

  /**
   * Resolve the working dir for a task: its own worktree if it still exists on
   * disk, else the mission/project workdir. A task's worktree can be removed
   * after its PR is merged, so every task-scoped source endpoint must use this
   * instead of trusting `task.worktree_path` blindly — otherwise git runs in a
   * deleted directory and the endpoint 500s.
   */
  function taskWorkDir(task: { worktree_path: string | null; mission_id: string }): {
    workDir: string | null;
    worktreeExists: boolean;
  } {
    const dir = missionWorkDir(task.mission_id);
    const wt = task.worktree_path?.trim();
    const worktreeExists = !!wt && existsSync(wt);
    return { workDir: worktreeExists ? wt : dir, worktreeExists };
  }

  // ---- Source control (workspace panel) ----
  app.get('/api/missions/:id/source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const m = store.getMission(id);
    const { getSourceStatus } = await import('../git/status.js');
    const status = await getSourceStatus(dir, m?.worktree_path ?? null).catch(() => null);
    if (!status) return reply.code(500).send({ error: 'could not read source status' });
    // Mission scope also exposes the project's branches + worktrees so the
    // branch combobox and worktree list render on missions too (not just projects).
    const proj = store.getProject(m?.project_id ?? '');
    if (proj) {
      const { listWorktrees } = await import('../git/worktree.js');
      const { listBranches } = await import('../git/branch.js');
      status.worktrees = await listWorktrees(proj.path).catch(() => []);
      status.branches = await listBranches(proj.path).catch(() => []);
    }
    return status;
  });

  app.post('/api/missions/:id/source/commit', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const { message } = req.body as { message?: string };
    const { commitChanges } = await import('../git/status.js');
    const sha = await commitChanges(dir, message ?? '');
    if (!sha) return reply.code(400).send({ error: 'commit failed (empty message or no changes)' });
    return { sha };
  });

  app.post('/api/missions/:id/source/push', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const { push } = await import('../git/status.js');
    const ok = await push(dir);
    if (!ok) return reply.code(400).send({ error: 'push failed' });
    return { ok: true };
  });

  app.post('/api/missions/:id/source/revert', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const { revertChanges } = await import('../git/status.js');
    const ok = await revertChanges(dir);
    if (!ok) return reply.code(400).send({ error: 'revert failed' });
    return { ok: true };
  });

  app.post('/api/missions/:id/source/pr', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const { title, body } = req.body as { title?: string; body?: string };
    const { createPr } = await import('../git/status.js');
    try {
      const url = await createPr(dir, title ?? '', body ?? null);
      return { url };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/api/missions/:id/source/diff', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const file = (req.query as { file?: string }).file ?? '';
    const { getFileDiff } = await import('../git/status.js');
    const diff = await getFileDiff(dir, file).catch(() => '');
    return { diff };
  });

  app.post('/api/missions/:id/source/checkout', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const { branch } = req.body as { branch?: string };
    if (!branch?.trim()) return reply.code(400).send({ error: 'branch required' });
    const { checkoutBranch } = await import('../git/branch.js');
    try {
      const result = await checkoutBranch(dir, branch.trim());
      return { ok: true, branch: result ?? branch.trim() };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/api/missions/:id/source/commits', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const { listCommits } = await import('../git/status.js');
    const commits = await listCommits(dir).catch(() => []);
    return { commits };
  });

  // ---- File browser (workspace panel) ----
  app.get('/api/missions/:id/files', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const relPath = (req.query as { path?: string }).path ?? '';
    const { listFiles } = await import('../git/files.js');
    try {
      const entries = await listFiles(dir, relPath);
      return { root: dir, entries };
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }
  });

  app.get('/api/missions/:id/files/content', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const relPath = (req.query as { path?: string }).path ?? '';
    const { readFileContent } = await import('../git/files.js');
    try {
      const result = await readFileContent(dir, relPath);
      if (result === null) return reply.code(415).send({ error: 'binary or too large' });
      return result;
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }
  });

  app.post('/api/missions/:id/files/content', async (req, reply) => {
    const { id } = req.params as { id: string };
    const dir = missionWorkDir(id);
    if (!dir) return reply.code(404).send({ error: 'mission not found' });
    const { path, content } = req.body as { path?: string; content?: string };
    const { writeFileContent } = await import('../git/files.js');
    try {
      await writeFileContent(dir, path ?? '', content ?? '');
      return { ok: true };
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }
  });

  // ---- Project-level workspace panel (source control + files over the whole repo) ----
  const sourceStatus = async (dir: string) => {
    const { getSourceStatus } = await import('../git/status.js');
    const status = await getSourceStatus(dir, null).catch(() => null);
    if (!status) return null;
    const { listWorktrees } = await import('../git/worktree.js');
    const worktrees = await listWorktrees(dir).catch(() => []);
    const { listBranches } = await import('../git/branch.js');
    const branches = await listBranches(dir).catch(() => []);
    return { ...status, worktrees, branches };
  };

  app.get('/api/projects/:id/source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const result = await sourceStatus(proj.path);
    if (!result) return reply.code(500).send({ error: 'could not read source status' });
    return result;
  });

  app.post('/api/projects/:id/source/commit', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { message } = req.body as { message?: string };
    const { commitChanges } = await import('../git/status.js');
    const sha = await commitChanges(proj.path, message ?? '');
    if (!sha) return reply.code(400).send({ error: 'commit failed (empty message or no changes)' });
    return { sha };
  });

  app.post('/api/projects/:id/source/push', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { push } = await import('../git/status.js');
    const ok = await push(proj.path);
    if (!ok) return reply.code(400).send({ error: 'push failed' });
    return { ok: true };
  });

  app.post('/api/projects/:id/source/revert', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { revertChanges } = await import('../git/status.js');
    const ok = await revertChanges(proj.path);
    if (!ok) return reply.code(400).send({ error: 'revert failed' });
    return { ok: true };
  });

  app.post('/api/projects/:id/source/pr', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { title, body } = req.body as { title?: string; body?: string };
    const { createPr } = await import('../git/status.js');
    try {
      const url = await createPr(proj.path, title ?? '', body ?? null);
      return { url };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/api/projects/:id/source/diff', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const file = (req.query as { file?: string }).file ?? '';
    const { getFileDiff } = await import('../git/status.js');
    const diff = await getFileDiff(proj.path, file).catch(() => '');
    return { diff };
  });

  app.post('/api/projects/:id/source/checkout', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { branch } = req.body as { branch?: string };
    if (!branch?.trim()) return reply.code(400).send({ error: 'branch required' });
    const { checkoutBranch } = await import('../git/branch.js');
    try {
      const result = await checkoutBranch(proj.path, branch.trim());
      return { ok: true, branch: result ?? branch.trim() };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/api/projects/:id/source/commits', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { listCommits } = await import('../git/status.js');
    const commits = await listCommits(proj.path).catch(() => []);
    return { commits };
  });

  app.get('/api/projects/:id/files', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const relPath = (req.query as { path?: string }).path ?? '';
    const { listFiles } = await import('../git/files.js');
    try {
      const entries = await listFiles(proj.path, relPath);
      return { root: proj.path, entries };
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }
  });

  app.get('/api/projects/:id/files/content', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const relPath = (req.query as { path?: string }).path ?? '';
    const { readFileContent } = await import('../git/files.js');
    try {
      const result = await readFileContent(proj.path, relPath);
      if (result === null) return reply.code(415).send({ error: 'binary or too large' });
      return result;
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }
  });

  app.post('/api/projects/:id/files/content', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { path, content } = req.body as { path?: string; content?: string };
    const { writeFileContent } = await import('../git/files.js');
    try {
      await writeFileContent(proj.path, path ?? '', content ?? '');
      return { ok: true };
    } catch (e) {
      return reply.code(403).send({ error: (e as Error).message });
    }
  });


  app.post('/api/missions/:id/start', async (req, reply) => {
    const { id } = req.params as { id: string };
    const mission = store.getMission(id);
    if (!mission) return reply.code(404).send({ error: 'mission not found' });
    const runner = app.runner;
    const worktreePath = await runner.createWorktreeForMission(id);
    if (worktreePath) store.updateMission(id, { worktree_path: worktreePath });
    const result = await runner.start(id);
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return { ok: true };
  });

  app.post('/api/missions/:id/pause', async (req) => {
    const { id } = req.params as { id: string };
    await app.runner.pause(id);
    return { ok: true };
  });

  app.post('/api/missions/:id/resume', async (req) => {
    const { id } = req.params as { id: string };
    await app.runner.resume(id);
    return { ok: true };
  });

  app.post('/api/missions/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    await app.runner.stop(id);
    return { ok: true };
  });

  app.post('/api/missions/:id/interrupt', async (req) => {
    const { id } = req.params as { id: string };
    const { message } = req.body as { message: string };
    await app.runner.interrupt(id, message);
    return { ok: true };
  });

  app.delete('/api/missions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const mission = store.getMission(id);
    if (mission?.worktree_path) await app.runner.cleanupWorktreeForMission(id);
    store.deleteMission(id);
    return { ok: true };
  });

  /** Update a mission (name, objective, driver, etc.). */
  app.patch('/api/missions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, any>;
    const mission = store.updateMission(id, {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.objective !== undefined ? { objective: String(body.objective) } : {}),
      ...(body.gitStrategy !== undefined ? { git_strategy: body.gitStrategy as 'worktree' | 'branch' | 'none' } : {}),
      ...(body.driver?.profile !== undefined ? { driver_profile: body.driver.profile as string } : {}),
      ...(body.driver?.model !== undefined ? { driver_model: String(body.driver.model) } : {}),
      ...(body.driver?.provider !== undefined ? { driver_provider: (body.driver.provider as string) || null } : {}),
    });
    return mission;
  });

  // ---- Tasks ----
  app.get('/api/missions/:id/tasks', async (req) => {
    const { id } = req.params as { id: string };
    return { tasks: store.listTasks(id) };
  });

  app.post('/api/missions/:id/tasks', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, any>;
    const mission = store.getMission(id);
    const task = store.createTask({
      mission_id: id,
      title: String(body.title),
      description: (body.description as string) ?? null,
      state: (body.state as TaskState) ?? 'todo',
      parent_id: (body.parentId as string) ?? null,
      depends_on: JSON.stringify((body.dependsOn as string[]) ?? []),
      agent_type: (body.agent?.type as string) ?? null,
      agent_llm: (body.agent?.llm as string) ?? null,
      agent_system_prompt: (body.agent?.systemPrompt as string) ?? null,
      // Orchestrator (parent) task config.
      git_strategy: (body.gitStrategy as 'worktree' | 'branch' | 'none') ?? null,
      branch: (body.branch as string) ?? null,
      base_branch: (body.baseBranch as string) ?? null,
      driver_profile: (body.driver?.profile as string) ?? null,
      driver_model: (body.driver?.model as string) ?? null,
      driver_provider: (body.driver?.provider as string) ?? null,
      subagent_ids: JSON.stringify((body.subagentIds as string[]) ?? []),
      review_pr_project_id: (body.reviewPrProjectId as string) ?? null,
      review_pr_number: (body.reviewPrNumber as number) ?? null,
      worktree_path: (body.worktreePath as string) ?? null,
      sort_order: (body.order as number) ?? 0,
    });
    store.addEvent({
      missionId: id, projectId: mission?.project_id, taskId: task.id,
      type: 'task_created', payload: { title: task.title, state: task.state, parent_id: task.parent_id },
    });
    hub.emit('mission', id, 'task_created', { task });
    return task;
  });

  app.patch('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const agent = (body.agent ?? {}) as { type?: string; llm?: string; provider?: string; systemPrompt?: string };
    const driver = (body.driver ?? {}) as { profile?: string; model?: string; provider?: string };
    const before = store.getTask(id);

    // If dependsOn is being changed, validate it doesn't create a dependency
    // cycle among the task's siblings before persisting.
    if (body.dependsOn !== undefined) {
      const next = (body.dependsOn as string[]) ?? [];
      const task = store.getTask(id);
      if (task) {
        const siblings = store.listTasks(task.mission_id).filter((t) => t.parent_id === task.parent_id);
        const depOf = new Map<string, string[]>();
        for (const s of siblings) {
          let deps: string[] = [];
          try { deps = JSON.parse(s.depends_on || '[]'); } catch { deps = []; }
          depOf.set(s.id, s.id === id ? next : deps);
        }
        // DFS cycle detection over the dependency graph.
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const hasCycle = (node: string): boolean => {
          if (visiting.has(node)) return true;
          if (visited.has(node)) return false;
          visiting.add(node);
          for (const d of depOf.get(node) ?? []) {
            if (hasCycle(d)) return true;
          }
          visiting.delete(node);
          visited.add(node);
          return false;
        };
        if (hasCycle(id)) {
          return reply.code(409).send({ error: 'dependency cycle detected' });
        }
      }
    }

    const task = store.updateTask(id, {
      ...(body.state ? { state: body.state as TaskState } : {}),
      ...(body.title ? { title: String(body.title) } : {}),
      ...(body.description !== undefined ? { description: body.description ? String(body.description) : null } : {}),
      ...(agent.type !== undefined ? { agent_type: agent.type || null } : {}),
      ...(agent.llm !== undefined ? { agent_llm: agent.llm || null } : {}),
      ...(agent.provider !== undefined ? { agent_provider: agent.provider || null } : {}),
      ...(agent.systemPrompt !== undefined ? { agent_system_prompt: agent.systemPrompt || null } : {}),
      ...(body.gitStrategy !== undefined ? { git_strategy: body.gitStrategy as 'worktree' | 'branch' | 'none' | null } : {}),
      ...(body.branch !== undefined ? { branch: (body.branch as string) || null } : {}),
      ...(driver.profile !== undefined ? { driver_profile: driver.profile || null } : {}),
      ...(driver.model !== undefined ? { driver_model: driver.model || null } : {}),
      ...(driver.provider !== undefined ? { driver_provider: driver.provider || null } : {}),
      ...(body.subagentIds !== undefined ? { subagent_ids: JSON.stringify(body.subagentIds as string[]) } : {}),
      ...(body.dependsOn !== undefined ? { depends_on: JSON.stringify(body.dependsOn as string[]) } : {}),
    });

    // Only record a history event when the visible state (kanban state or run_state)
    // actually changed. Skip no-op PATCHes so the history isn't spammed with
    // `todo -> todo` entries (e.g. when the UI re-saves the same value on focus).
    const wasState = before?.state;
    const wasRunState = before?.run_state;
    const stateChanged = wasState !== task.state || wasRunState !== task.run_state;
    if (stateChanged || body.title !== undefined) {
      store.addEvent({
        missionId: task.mission_id, taskId: task.id,
        type: 'task_status', payload: { before: { state: wasState, run_state: wasRunState }, after: { state: task.state, run_state: task.run_state, title: task.title } },
      });
      hub.emit('mission', task.mission_id, 'task_status', { task });
    }
    return task;
  });

  /** Delete a task (and its subtasks via cascade). */
  app.delete('/api/tasks/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { removeWorktree } = req.query as { removeWorktree?: string };
    const task = store.getTask(id);
    if (!task) return { ok: true };
    // If the task owns a worktree (its own, not the mission's), remove it so
    // the directory + contents are cleaned up — UNLESS the caller explicitly
    // asked to keep it (removeWorktree=false). The mission's worktree is left
    // alone — it's shared and removed when the mission is deleted.
    const mission = store.getMission(task.mission_id);
    const isOwnWorktree = task.worktree_path && mission?.worktree_path !== task.worktree_path;
    const shouldRemoveWorktree = removeWorktree !== 'false';
    if (isOwnWorktree && shouldRemoveWorktree) {
      await app.runner.cleanupWorktreeForTask(id);
    }
    store.deleteTask(id);
    hub.emit('mission', task.mission_id, 'task_deleted', { id });
    return { ok: true };
  });

  /** Run a single task as its own subagent (orchestrator is always Hermes). */
  app.post('/api/tasks/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await app.runner.runTask(id);
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return { ok: true };
  });

  /** Stop a running task subagent. */
  app.post('/api/tasks/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    await app.runner.stopTask(id);
    return { ok: true };
  });

  /** Run the planner for an orchestrator task and materialize its subtasks.
   *  Async: marks the task `planning` and returns immediately; the planner
   *  runs in the background and the board updates live over the WebSocket.
   *  The persisted `planning` state survives a page refresh. */
  app.post('/api/tasks/:id/plan', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    // Create the orchestrator task's worktree (if its git strategy is worktree)
    // before planning, so subtasks have a place to work.
    await app.runner.createWorktreeForTask(id);
    const result = await app.runner.planTaskAsync(id);
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return { ok: true };
  });

  /** Create a PR from a task's worktree/branch. Uses the task's worktree dir
   *  (falling back to the project dir) and pushes the current branch to origin,
   *  then opens a PR via `gh` against the given base (or the default). Returns the PR URL. */
  app.post('/api/tasks/:id/pr', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const mission = store.getMission(task.mission_id);
    const projectId = mission?.project_id;
    const project = projectId ? store.getProject(projectId) : undefined;
    // Resolve the directory: the task's own worktree (if it still exists),
    // else the mission worktree, else the project checkout.
    const { workDir, worktreeExists } = taskWorkDir(task);
    if (!workDir) return reply.code(404).send({ error: 'no work directory for task' });
    const { title, body, base } = req.body as { title?: string; body?: string; base?: string };
    const { push, createPr, commitChanges, getSourceStatus } = await import('../git/status.js');
    try {
      // If the agent left uncommitted changes, commit them so the branch has
      // actual commits ahead of base — otherwise GitHub rejects the PR with
      // "No commits between <base> and <branch>".
      const status = await getSourceStatus(workDir, worktreeExists ? task.worktree_path : null).catch(() => null);
      const dirty = status?.files && status.files.length > 0;
      if (dirty) {
        const msg = title?.trim() || task.title || `Work from task: ${task.id}`;
        const sha = await commitChanges(workDir, msg);
        if (!sha) return reply.code(400).send({ error: 'no changes to commit before creating PR' });
      }
      const pushed = await push(workDir);
      if (!pushed) return reply.code(400).send({ error: 'push failed (no current branch?)' });
      const url = await createPr(workDir, title ?? task.title, body ?? null, base ?? undefined);
      // Persist the created PR URL on the task so the UI can offer a "View PR"
      // link once the task is done (and keep showing it after returning to it).
      store.updateTask(id, { pr_url: url });
      return { url, projectId, projectName: project?.name ?? null };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  /** Source status for a task's worktree/branch — used by the Create-PR modal's
   *  Files tab and the workspace source tab. Same shape as mission/project source. */
  app.get('/api/tasks/:id/source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    // The task's worktree may have been removed (e.g. after its PR was merged).
    // If it no longer exists on disk, fall back to the mission/project workdir
    // instead of failing with a 500 — the UI still needs a source status to
    // render the Create-PR modal and source tab.
    const { workDir, worktreeExists } = taskWorkDir(task);
    if (!workDir) return reply.code(404).send({ error: 'no work directory for task' });
    const { getSourceStatus } = await import('../git/status.js');
    const status = await getSourceStatus(workDir, worktreeExists ? task.worktree_path : null).catch(() => null);
    if (!status) return reply.code(500).send({ error: 'could not read source status' });
    // Expose the repo's branches so the PR base combobox can be populated.
    const mission = store.getMission(task.mission_id);
    const proj = store.getProject(mission?.project_id ?? '');
    if (proj) {
      const { listBranches } = await import('../git/branch.js');
      status.branches = await listBranches(proj.path).catch(() => []);
    }
    // Detect an existing open PR for the task's branch (covers tasks created
    // before pr_url was persisted) so the UI can offer "View PR" instead of
    // "no changes" / "create PR". Uses the worktree's current branch
    // (status.branch) since task.branch may be empty for worktree tasks.
    let pr: { url: string; number: number; projectId: string | null } | null = null;
    const branchForPr = status.branch ?? task.branch;
    try {
      if (proj?.path && branchForPr) {
        const { isGhAvailable } = await import('../git/status.js');
        if (await isGhAvailable()) {
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const exec = promisify(execFile);
          const { stdout } = await exec('gh', ['pr', 'list', '--json', 'number,headRefName,url,state', '--limit', '100', '--jq', `.[] | select(.headRefName=="${branchForPr}") | {number,url,state}`], { cwd: proj.path, timeout: 15000 });
          const match = stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((p) => p?.state !== 'MERGED');
          if (match) pr = { url: match.url as string, number: match.number as number, projectId: proj?.id ?? null };
        }
      }
    } catch { /* ignore */ }
    status.pr = pr;
    return status;
  });

  /** Unified diff for a single changed file in the task's worktree. */
  app.get('/api/tasks/:id/source/diff', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const { workDir } = taskWorkDir(task);
    if (!workDir) return reply.code(404).send({ error: 'no work directory for task' });
    const file = (req.query as { file?: string }).file ?? '';
    const { getFileDiff } = await import('../git/status.js');
    const diff = await getFileDiff(workDir, file).catch(() => '');
    return { diff };
  });

  /** Commit the task's uncommitted changes (in its worktree/branch). */
  app.post('/api/tasks/:id/source/commit', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const { workDir } = taskWorkDir(task);
    if (!workDir) return reply.code(404).send({ error: 'no work directory for task' });
    const { message } = req.body as { message?: string };
    const { commitChanges } = await import('../git/status.js');
    const sha = await commitChanges(workDir, message ?? '');
    if (!sha) return reply.code(400).send({ error: 'commit failed (empty message or no changes)' });
    return { sha };
  });

  /** Push the task's current branch to origin. */
  app.post('/api/tasks/:id/source/push', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const { workDir } = taskWorkDir(task);
    if (!workDir) return reply.code(404).send({ error: 'no work directory for task' });
    const { push } = await import('../git/status.js');
    const ok = await push(workDir);
    if (!ok) return reply.code(400).send({ error: 'push failed' });
    return { ok: true };
  });

  /** Discard all uncommitted changes in the task's worktree/branch. */
  app.post('/api/tasks/:id/source/revert', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const { workDir } = taskWorkDir(task);
    if (!workDir) return reply.code(404).send({ error: 'no work directory for task' });
    const { revertChanges } = await import('../git/status.js');
    const ok = await revertChanges(workDir);
    if (!ok) return reply.code(400).send({ error: 'revert failed' });
    return { ok: true };
  });

  /** Checkout a branch in the task's worktree. */
  app.post('/api/tasks/:id/source/checkout', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const { workDir } = taskWorkDir(task);
    if (!workDir) return reply.code(404).send({ error: 'no work directory for task' });
    const { branch } = req.body as { branch?: string };
    if (!branch?.trim()) return reply.code(400).send({ error: 'branch required' });
    const { checkoutBranch } = await import('../git/branch.js');
    try {
      const result = await checkoutBranch(workDir, branch.trim());
      return { ok: true, branch: result ?? branch.trim() };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  /** List commits in the task's worktree/branch. */
  app.get('/api/tasks/:id/source/commits', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const { workDir } = taskWorkDir(task);
    if (!workDir) return reply.code(404).send({ error: 'no work directory for task' });
    const { listCommits } = await import('../git/status.js');
    const commits = await listCommits(workDir).catch(() => []);
    return { commits };
  });

  /**
   * Kanban sync: accept a batch of tasks (create or update by title) so an
   * orchestrator agent can report board state. Returns the created/updated tasks.
   */
  app.post('/api/missions/:id/tasks/sync', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      tasks?: Array<{
        title: string; state?: TaskState; description?: string; agentType?: string;
        agentModel?: string; agentProvider?: string; systemPrompt?: string;
        parentTitle?: string; dependsOnTitles?: string[];
      }>;
    };
    const mission = store.getMission(id);
    if (!mission) return { error: 'mission not found' };
    let existing = store.listTasks(id);
    const results = [];
    // Resolve a task id from a title, creating it if missing (so parents can be
    // referenced by title before/without being fully specified).
    const resolveId = (title: string, t: Record<string, unknown>): string | null => {
      const found = existing.find((e) => e.title === title);
      if (found) return found.id;
      const created = store.createTask({
        mission_id: id, title, description: null, state: 'todo', parent_id: null,
        depends_on: '[]', agent_type: null, agent_llm: null, agent_provider: null,
        agent_system_prompt: null, sort_order: existing.length + results.length,
      });
      existing = store.listTasks(id);
      return created.id;
    };
    for (const t of body.tasks ?? []) {
      const found = existing.find((e) => e.title === t.title);
      if (found) {
        const updated = store.updateTask(found.id, {
          ...(t.state ? { state: t.state } : {}),
          ...(t.description ? { description: t.description } : {}),
          ...(t.agentType !== undefined ? { agent_type: t.agentType } : {}),
          ...(t.agentModel !== undefined ? { agent_llm: t.agentModel } : {}),
          ...(t.agentProvider !== undefined ? { agent_provider: t.agentProvider } : {}),
          ...(t.systemPrompt !== undefined ? { agent_system_prompt: t.systemPrompt } : {}),
          ...(t.parentTitle !== undefined && t.parentTitle
            ? { parent_id: resolveId(t.parentTitle, t) } : {}),
        });
        results.push(updated);
        hub.emit('mission', id, 'task_status', { task: updated });
      } else {
        let parentId: string | null = null;
        if (t.parentTitle) parentId = resolveId(t.parentTitle, t);
        let dependsOn: string[] = [];
        if (t.dependsOnTitles && t.dependsOnTitles.length > 0) {
          dependsOn = t.dependsOnTitles.map((x) => resolveId(x, t)).filter(Boolean) as string[];
        }
        const created = store.createTask({
          mission_id: id, title: t.title,
          description: t.description ?? null,
          state: t.state ?? 'todo',
          parent_id: parentId, depends_on: JSON.stringify(dependsOn),
          agent_type: t.agentType ?? null,
          agent_llm: t.agentModel ?? null,
          agent_provider: t.agentProvider ?? null,
          agent_system_prompt: t.systemPrompt ?? null,
          sort_order: existing.length + results.length,
        });
        results.push(created);
        hub.emit('mission', id, 'task_created', { task: created });
      }
    }
    return { tasks: results };
  });

  // ---- Agent runs & logs (telemetry) ----
  app.get('/api/missions/:id/runs', async (req) => {
    const { id } = req.params as { id: string };
    return { runs: store.listRunsForMission(id) };
  });

  app.get('/api/tasks/:id/runs', async (req) => {
    const { id } = req.params as { id: string };
    return { runs: store.listRunsForTask(id) };
  });

  /** History of task/mission events (state changes, assignments, creation). */
  app.get('/api/missions/:id/events', async (req) => {
    const { id } = req.params as { id: string };
    const { taskId } = req.query as { taskId?: string };
    return { events: store.listEvents(id, taskId) };
  });

  app.get('/api/runs/:id/logs', async (req) => {
    const { id } = req.params as { id: string };
    return { logs: store.listLogsForRun(id) };
  });

  /** All logs for a mission, each tagged with its task_id (for the Logs tab filter). */
  app.get('/api/missions/:id/logs', async (req) => {
    const { id } = req.params as { id: string };
    return { logs: store.listLogsForMission(id) };
  });

  // ---- Agent config ----
  app.get('/api/agents-config', async () => ({ agents: store.listAgentConfig() }));

  app.get('/api/stats', async () => ({ stats: store.countTasks() }));
  app.post('/api/agents-config', async (req) => {
    const body = req.body as Record<string, unknown>;
    const agent = store.createAgentConfig({
      name: String(body.name ?? 'agent'),
      enabled: body.enabled !== false ? 1 : 0,
      role: (body.role as 'driver' | 'subagent' | 'both') ?? 'both',
      default_llm: (body.defaultLlm as string) ?? null,
      profile: (body.profile as string) ?? null,
      provider: (body.provider as string) ?? null,
      system_prompt: (body.systemPrompt as string) ?? null,
    });
    return { agent };
  });
  app.delete('/api/agents-config/:id', async (req) => {
    const { id } = req.params as { id: string };
    store.deleteAgentConfig(id);
    return { ok: true };
  });
  app.patch('/api/agents-config/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    store.updateAgentConfig(id, {
      ...(body.enabled !== undefined ? { enabled: body.enabled ? 1 : 0 } : {}),
      ...(body.defaultLlm !== undefined ? { default_llm: String(body.defaultLlm) } : {}),
      ...(body.systemPrompt !== undefined ? { system_prompt: String(body.systemPrompt) } : {}),
      ...(body.profile !== undefined ? { profile: (body.profile as string) || null } : {}),
      ...(body.provider !== undefined ? { provider: (body.provider as string) || null } : {}),
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
    });
    return { ok: true };
  });

  // ---- Hermes query (profiles / providers / models) ----
  // The orchestrator is always Hermes, so the mission form lists Hermes
  // profiles, then providers, then models per provider — all sourced live
  // from the installed Hermes CLI.
  app.get('/api/hermes/profiles', async () => {
    const { listHermesProfiles } = await import('../hermes/query.js');
    return { profiles: await listHermesProfiles() };
  });

  /** List recent interactive sessions for a Hermes profile (floating chat resume picker). */
  app.get('/api/hermes/sessions', async (req) => {
    const { profile, source } = req.query as { profile?: string; source?: string };
    const { listHermesSessions } = await import('../hermes/query.js');
    return { sessions: await listHermesSessions(profile, source) };
  });

  /** One-shot chat with a Hermes profile (floating chat in the UI). */
  app.post('/api/hermes/chat', async (req) => {
    const body = req.body as { message?: string; profile?: string; model?: string; provider?: string; session_id?: string };
    if (!body.message?.trim()) return { reply: '' };
    const { chatWithHermes } = await import('../hermes/query.js');
    return chatWithHermes(body.message.trim(), {
      profile: body.profile, model: body.model, provider: body.provider, session_id: body.session_id,
    });
  });

  /** Manually run the stale-state watchdog and report what it recovered. */
  app.post('/api/watchdog', async () => app.runner.watchdog());

  /** Live status: which tasks/missions are marked active, and whether a real
   *  OS process is alive behind each one. Lets the UI show "running" vs
   *  "stale/crashed" (active state but no live process). */
  app.get('/api/live-status', async () => app.runner.liveStatus());

  /** Health check: is the API up, is Hermes reachable, and which profiles are online. */
  app.get('/api/health', async () => {
    const { hermesHealth } = await import('../hermes/query.js');
    const hermes = await hermesHealth();
    return {
      apiOnline: true,
      hermesOnline: hermes.hermesOnline,
      profiles: hermes.profiles,
      timestamp: Date.now(),
    };
  });

  app.get('/api/hermes/providers', async () => {
    const { listHermesProviders } = await import('../hermes/query.js');
    return { providers: await listHermesProviders() };
  });

  app.get('/api/hermes/models', async (req) => {
    const { provider } = req.query as { provider?: string };
    if (!provider) return { models: [] };
    const { listHermesModels } = await import('../hermes/query.js');
    return { models: await listHermesModels(provider) };
  });

  /** List installed Hermes skills grouped by category (from the skills dir on disk). */
  app.get('/api/hermes/skills', async () => {
    const { listHermesSkills } = await import('../hermes/query.js');
    return { skills: await listHermesSkills() };
  });

  /** List configured Hermes MCP servers (from config.yaml). */
  app.get('/api/hermes/mcp', async () => {
    const { listHermesMcpServers } = await import('../hermes/query.js');
    return { servers: await listHermesMcpServers() };
  });

  // ---- Tasks: blocked / in-error (Resume section on the home screen) ----
  app.get('/api/tasks/problematic', async () => {
    const { listProblematicTasks } = await import('../db/problematic.js');
    return { tasks: listProblematicTasks(store) };
  });

  // ---- GitHub Tasks: PRs across all projects ----
  app.get('/api/prs', async (req, reply) => {
    const projects = store.listProjects().map((p) => ({ id: p.id, name: p.name, path: p.path }));
    const { listAllPrs } = await import('../git/github.js');
    try {
      return { prs: await listAllPrs(projects) };
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  });

  app.get('/api/projects/:id/prs/:number', async (req, reply) => {
    const { id, number } = req.params as { id: string; number: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { getPrDetail } = await import('../git/github.js');
    try {
      const detail = await getPrDetail(proj.path, parseInt(number, 10));
      return { pr: { ...detail, projectId: id, projectName: proj.name } };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/projects/:id/prs/:number/merge', async (req, reply) => {
    const { id, number } = req.params as { id: string; number: string };
    const { method, deleteLocal } = req.body as { method?: string; deleteLocal?: boolean };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { mergePr } = await import('../git/github.js');
    try {
      await mergePr(proj.path, parseInt(number, 10), method ?? 'merge', !!deleteLocal);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get('/api/projects/:id/prs/:number/diff', async (req, reply) => {
    const { id, number } = req.params as { id: string; number: string };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { getPrDiff } = await import('../git/github.js');
    try {
      const diff = await getPrDiff(proj.path, parseInt(number, 10));
      return { diff };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/projects/:id/prs/:number/state', async (req, reply) => {
    const { id, number } = req.params as { id: string; number: string };
    const { closed } = req.body as { closed?: boolean };
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { setPrState } = await import('../git/github.js');
    try {
      await setPrState(proj.path, parseInt(number, 10), !!closed);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/projects/:id/prs/:number/comment', async (req, reply) => {
    const { id, number } = req.params as { id: string; number: string };
    const { body } = req.body as { body?: string };
    if (!body?.trim()) return reply.code(400).send({ error: 'comment body required' });
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { addPrComment } = await import('../git/github.js');
    try {
      await addPrComment(proj.path, parseInt(number, 10), body.trim());
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/projects/:id/prs/:number/worktree', async (req, reply) => {
    const { id, number } = req.params as { id: string; number: string };
    const { branch } = req.body as { branch?: string };
    if (!branch?.trim()) return reply.code(400).send({ error: 'branch required' });
    const proj = store.getProject(id);
    if (!proj?.path) return reply.code(404).send({ error: 'project not found' });
    const { createWorktreeFromPr } = await import('../git/github.js');
    try {
      const path = await createWorktreeFromPr(proj.path, parseInt(number, 10), branch.trim());
      return { ok: true, path };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- Notifications ----
  app.get('/api/notifications', async () => {
    const notifications = store.listNotifications();
    return { notifications, unread: store.countUnread() };
  });

  app.post('/api/notifications/:id/read', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getNotification(id)) {
      return reply.code(404).send({ error: 'notification not found' });
    }
    store.markNotificationRead(id);
    return { ok: true };
  });

  app.post('/api/notifications/read-all', async () => {
    store.markAllNotificationsRead();
    return { ok: true };
  });

  app.delete('/api/notifications/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getNotification(id)) {
      return reply.code(404).send({ error: 'notification not found' });
    }
    store.deleteNotification(id);
    return { ok: true };
  });

  // ---- Settings (notification sound preference) ----
  app.get('/api/settings/notifications', async () => {
    const sound = store.getSetting('notifications.sound') !== 'false';
    return { sound };
  });

  app.patch('/api/settings/notifications', async (req, reply) => {
    const { sound } = req.body as { sound?: unknown };
    if (typeof sound !== 'boolean') {
      return reply.code(400).send({ error: 'sound must be a boolean' });
    }
    store.setSetting('notifications.sound', sound ? 'true' : 'false');
    return { sound: store.getSetting('notifications.sound') !== 'false' };
  });
}

type TaskState = 'todo' | 'doing' | 'blocked' | 'done';

async function isGitRepo(path: string): Promise<boolean> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    await exec('git', ['-C', path, 'rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}
