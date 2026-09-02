import { existsSync } from 'node:fs';
import { Store } from './db/store.js';
import { isGitRepo } from './git/scan.js';

/**
 * Seed the Hermes Commander DB with the user's throwaway test repos so the app and
 * tests always have projects to work with. Idempotent: skips paths already
 * registered, and re-registers a path if it was moved (old entry removed).
 *
 * Usage: `HERMES_COMMANDER_DB=<path> npx tsx src/seed.ts`
 */
const TEST_PROJECTS = [
  { path: '/Users/anibal/Projects/ani-test-1', name: 'ani-test-1' },
  { path: '/Users/anibal/Projects/ani-test-2', name: 'ani-test-2' },
];

export async function seedTestProjects(store: Store): Promise<{ added: string[]; skipped: string[]; removed: string[] }> {
  const added: string[] = [];
  const skipped: string[] = [];
  const removed: string[] = [];

  // Remove registrations for test projects whose path no longer exists on disk
  // (e.g. the user moved the repo) so they don't linger as broken projects.
  for (const p of TEST_PROJECTS) {
    const existing = store.getProjectByPath(p.path);
    if (existing && !existsSync(p.path)) {
      store.deleteProject(existing.id);
      removed.push(p.name);
    }
  }

  for (const p of TEST_PROJECTS) {
    if (!existsSync(p.path)) {
      skipped.push(`${p.name} (missing)`);
      continue;
    }
    const existing = store.getProjectByPath(p.path);
    if (existing) {
      skipped.push(`${p.name} (already registered)`);
      continue;
    }
    const isGit = await isGitRepo(p.path);
    store.createProject({
      name: p.name, path: p.path, type: isGit ? 'git' : 'folder',
      remote_url: null, created_by: 'open', badge_color: null, parent_group: null,
    });
    added.push(p.name);
  }
  return { added, skipped, removed };
}

/**
 * Seed an example mission + orchestrator (parent) task so the user can try the
 * full flow (plan → subtasks → run) without building everything by hand.
 * Idempotent: only creates if the project has no missions yet.
 */
export function seedExampleMission(store: Store): { created: boolean; missionId?: string; taskId?: string } {
  const project = store.listProjects().find((p) => p.type === 'git');
  if (!project) return { created: false };
  const existing = store.listMissions(project.id);
  if (existing.length > 0) return { created: false };

  const mission = store.createMission({
    project_id: project.id,
    name: 'Example: landing page',
    objective: 'Build a landing page for a fictional SaaS product (Nova).',
    git_strategy: 'none',
    base_branch: null,
    worktree_path: null,
    driver_type: 'hermes',
    driver_profile: null,
    driver_model: 'deepseek-v4-flash:cloud',
    driver_provider: null,
    driver_worktree_flag: 0,
    uses_kanban: 1,
    intervention: 'autonomous',
    depends_on_mission_ids: '[]',
    max_concurrent: null,
    state: 'pending',
    session_id: null,
    started_at: null,
    finished_at: null,
  });

  // Orchestrator (parent) task with the full orchestrator config.
  const task = store.createTask({
    mission_id: mission.id,
    title: 'Orchestrator: build landing page',
    description: 'Plan and delegate the landing page build to the selected subagents, then review the result.',
    state: 'todo',
    parent_id: null,
    depends_on: '[]',
    agent_type: 'hermes',
    agent_llm: null,
    agent_provider: null,
    agent_system_prompt: null,
    git_strategy: 'worktree',
    driver_profile: null,
    driver_model: 'deepseek-v4-flash:cloud',
    driver_provider: null,
    worktree_path: null,
    subagent_ids: '[]',
    sort_order: 0,
  });

  return { created: true, missionId: mission.id, taskId: task.id };
}

// Run directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const dbPath = process.env.HERMES_COMMANDER_DB ?? 'data/hermes-commander.db';
  const store = new Store(dbPath);
  const { added, skipped, removed } = await seedTestProjects(store);
  console.log(`Seeded ${added.length} project(s): ${added.join(', ') || 'none'}`);
  if (removed.length) console.log(`Removed stale: ${removed.join(', ')}`);
  if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`);
  const ex = seedExampleMission(store);
  if (ex.created) console.log(`Seeded example mission + orchestrator task (mission ${ex.missionId}, task ${ex.taskId})`);
}
