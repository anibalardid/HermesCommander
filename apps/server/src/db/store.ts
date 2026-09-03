import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA, now, uuid } from './schema.js';

export type ProjectRow = {
  id: string; name: string; path: string; type: 'git' | 'folder';
  remote_url: string | null; created_by: 'open' | 'create' | 'clone';
  badge_color: string | null; parent_group: string | null;
  setup_script?: string | null;
  description?: string | null;
  created_at: number; updated_at: number;
};

export type MissionRow = {
  id: string; project_id: string; name: string; objective: string;
  git_strategy: 'worktree' | 'branch' | 'none'; base_branch: string | null;
  worktree_path: string | null; driver_type: string; driver_profile: string | null;
  driver_model: string; driver_provider: string | null;
  driver_worktree_flag: number; uses_kanban: number;
  intervention: 'autonomous' | 'approve-steps' | 'manual';
  depends_on_mission_ids: string; max_concurrent: number | null;
  state: 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  session_id: string | null; created_at: number; started_at: number | null;
  finished_at: number | null; updated_at: number;
};

export type TaskRow = {
  id: string; mission_id: string; title: string; description: string | null;
  spec: string | null;
  state: 'todo' | 'doing' | 'blocked' | 'done'; parent_id: string | null;
  run_state: 'idle' | 'planning' | 'delegating' | 'running' | 'waiting' | 'waiting_review' | 'paused' | 'failed' | 'waiting_user' | 'done';
  depends_on: string; agent_type: string | null; agent_llm: string | null;
  agent_provider: string | null; agent_profile: string | null;
  agent_system_prompt: string | null; sort_order: number;
  git_strategy: 'worktree' | 'branch' | 'none' | null;
  branch: string | null;
  base_branch: string | null;
  driver_profile: string | null; driver_model: string | null; driver_provider: string | null;
  worktree_path: string | null; subagent_ids: string;
  review_pr_project_id: string | null; review_pr_number: number | null;
  review_verdict: 'pass' | 'needs_changes' | 'reject' | null;
  is_fix_task: number;
  retry_count: number;
  pr_url: string | null;
  created_at: number; updated_at: number;
};

export type SubagentRecipeRow = {
  id: string; name: string; title: string;
  description: string; system_prompt: string;
  profile: string | null; provider: string | null; model: string | null; is_default: number;
  created_at: number; updated_at: number;
};

export type AgentRunRow = {
  id: string; mission_id: string; task_id: string | null; agent_type: string;
  role: 'driver' | 'subagent'; llm: string | null;
  state: 'running' | 'done' | 'failed' | 'interrupted';
  started_at: number; finished_at: number | null; exit_code: number | null;
  session_id: string | null;
};

export type AgentConfigRow = {
  id: string; name: string; enabled: number; role: 'driver' | 'subagent' | 'both';
  default_llm: string | null; profile: string | null; provider: string | null;
  system_prompt: string | null;
};

export type NotificationRow = {
  id: string; type: string; title: string; body: string;
  read: number; link: string | null; created_at: number;
};

/** Max length for notification title/body. Overlong values are truncated on write
 *  so the notifications table can't grow unbounded rows. */
export const MAX_NOTIFICATION_TITLE_LENGTH = 200;
export const MAX_NOTIFICATION_BODY_LENGTH = 2000;
/** Notifications older than this are pruned (retention). Default 30 days. */
export const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
    this.migrate();
    this.seedAgents();
    this.seedRecipes();
    // Retention: prune stale notifications on startup so the table can't grow
    // unbounded. Idempotent — safe on every boot.
    this.pruneNotifications();
  }

  /** Close the underlying database connection. */
  close(): void {
    this.db.close();
  }

  /** Additive migrations for databases created before a column existed. */
  private migrate(): void {
    const taskCols = this.db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
    if (!taskCols.some((c) => c.name === 'run_state')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN run_state TEXT NOT NULL DEFAULT 'idle'
        CHECK (run_state IN ('idle','planning','delegating','running','waiting','waiting_review','paused','failed','waiting_user','done'))`);
    }
    if (!taskCols.some((c) => c.name === 'agent_provider')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN agent_provider TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'git_strategy')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN git_strategy TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'branch')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN branch TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'spec')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN spec TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'agent_profile')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN agent_profile TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'driver_profile')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN driver_profile TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'driver_model')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN driver_model TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'driver_provider')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN driver_provider TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'worktree_path')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN worktree_path TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'subagent_ids')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN subagent_ids TEXT NOT NULL DEFAULT '[]'`);
    }
    if (!taskCols.some((c) => c.name === 'review_pr_project_id')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN review_pr_project_id TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'review_pr_number')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN review_pr_number INTEGER`);
    }
    if (!taskCols.some((c) => c.name === 'review_verdict')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN review_verdict TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'is_fix_task')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN is_fix_task INTEGER NOT NULL DEFAULT 0`);
    }
    if (!taskCols.some((c) => c.name === 'retry_count')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`);
    }
    if (!taskCols.some((c) => c.name === 'pr_url')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN pr_url TEXT`);
    }
    if (!taskCols.some((c) => c.name === 'base_branch')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN base_branch TEXT`);
    }
    const agentCols = this.db.prepare('PRAGMA table_info(agent_config)').all() as Array<{ name: string }>;
    if (!agentCols.some((c) => c.name === 'profile')) {
      this.db.exec(`ALTER TABLE agent_config ADD COLUMN profile TEXT`);
    }
    if (!agentCols.some((c) => c.name === 'provider')) {
      this.db.exec(`ALTER TABLE agent_config ADD COLUMN provider TEXT`);
    }
    const eventCols = this.db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
    if (!eventCols.some((c) => c.name === 'task_id')) {
      this.db.exec(`ALTER TABLE events ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE`);
    }
    const projCols = this.db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>;
    if (!projCols.some((c) => c.name === 'setup_script')) {
      this.db.exec(`ALTER TABLE projects ADD COLUMN setup_script TEXT`);
    }
    if (!projCols.some((c) => c.name === 'description')) {
      this.db.exec(`ALTER TABLE projects ADD COLUMN description TEXT`);
    }
    // Subagent recipes: collapse per-language title/description into a single
    // user-written title/description (P2). Populate from the English fields.
    const recipeCols = this.db.prepare('PRAGMA table_info(subagent_recipes)').all() as Array<{ name: string }>;
    if (!recipeCols.some((c) => c.name === 'title')) {
      this.db.exec(`ALTER TABLE subagent_recipes ADD COLUMN title TEXT`);
      this.db.exec(`ALTER TABLE subagent_recipes ADD COLUMN description TEXT`);
      this.db.exec(`UPDATE subagent_recipes SET title = title_en, description = description_en`);
    }
    if (!recipeCols.some((c) => c.name === 'profile')) {
      this.db.exec(`ALTER TABLE subagent_recipes ADD COLUMN profile TEXT`);
    }
    // Notifications + settings tables are created by SCHEMA (CREATE TABLE IF NOT
    // EXISTS), but re-assert them here so databases created before these tables
    // existed are upgraded idempotently.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL,
        read        INTEGER NOT NULL DEFAULT 0,
        link        TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
      );
    `);
  }

  private seedAgents(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS c FROM agent_config').get() as { c: number };
    if (count.c > 0) return;
    const ins = this.db.prepare(
      `INSERT INTO agent_config (id, name, enabled, role, default_llm) VALUES (?, ?, ?, ?, ?)`
    );
    const defaults: Array<[string, 'driver' | 'subagent' | 'both', string]> = [
      ['hermes', 'both', 'deepseek-v4-flash:cloud'],
      ['codex', 'subagent', ''],
      ['opencode', 'subagent', ''],
      ['claude', 'subagent', ''],
    ];
    for (const [name, role, llm] of defaults) {
      ins.run(uuid(), name, 1, role, llm);
    }
  }

  /** Seed the classic subagent recipe templates (idempotent). */
  private seedRecipes(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS c FROM subagent_recipes').get() as { c: number };
    if (count.c > 0) return;
    const nowTs = now();
    const ins = this.db.prepare(
      `INSERT INTO subagent_recipes
        (id,name,title,description,system_prompt,provider,model,is_default,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    type R = { name: string; title: string; description: string; sp: string; def?: number };
    const recipes: R[] = [
      {
        name: 'reviewer',
        title: 'Reviewer',
        description: 'Evaluates work against the plan/spec and reports pass/fail. Never fixes code.',
        sp: 'You are a strict code reviewer. You do NOT modify or fix any code. You evaluate the delivered work strictly against the provided specification or plan and report: (1) whether it PASSES or FAILS, (2) specific findings with file/line references, (3) a short list of required fixes. Be concise, factual, and gate-oriented.',
        def: 1,
      },
      {
        name: 'frontend',
        title: 'Frontend',
        description: 'Builds user-facing UI (HTML/CSS/JS/React) from the spec.',
        sp: 'You are a frontend engineer. Build the user-facing interface described in the spec. Follow the design and constraints exactly. Write clean, responsive, accessible code. Do not invent features beyond the spec. Report what you built and any deviations.',
      },
      {
        name: 'backend',
        title: 'Backend',
        description: 'Builds server/API/data logic from the spec.',
        sp: 'You are a backend engineer. Implement the server, API, and data logic described in the spec. Follow the stated architecture, contracts, and constraints. Write clean, typed, testable code. Report what you implemented and any decisions you made.',
      },
      {
        name: 'documentation',
        title: 'Documentation',
        description: 'Writes docs (README, guides, API reference).',
        sp: 'You are a technical writer. Produce clear, accurate documentation for the deliverable: README, setup/usage guides, and API reference as needed. Use the project language conventions. Focus on accuracy and usefulness for a developer.',
      },
      {
        name: 'marketing',
        title: 'Marketing',
        description: 'Creates copy, taglines, and value propositions.',
        sp: 'You are a marketing copywriter. Produce persuasive, clear copy: taglines, hero headlines, value propositions, and short landing sections. Match the brand voice. Prioritize clarity and conversion intent.',
      },
      {
        name: 'seo',
        title: 'SEO',
        description: 'Optimizes content/metadata for search engines.',
        sp: 'You are an SEO specialist. Review and optimize titles, meta descriptions, headings, structured data, and content structure for search engines. Recommend concrete, actionable changes. Do not write misleading content.',
      },
      {
        name: 'security',
        title: 'Security',
        description: 'Reviews code for vulnerabilities and best practices.',
        sp: 'You are a security engineer. Review the delivered code for vulnerabilities: injection, XSS, CSRF, secrets exposure, insecure dependencies, auth flaws. Report findings with severity and concrete remediation. Do not fix code; report only.',
      },
      {
        name: 'image',
        title: 'Images',
        description: 'Generates/produces visual assets (images, diagrams).',
        sp: 'You are a visual designer. Produce or specify the visual assets required by the spec (images, illustrations, diagrams). If you can generate images, do so; otherwise provide precise prompts and placement for a human/vision agent. Report assets delivered.',
      },
    ];
    for (const r of recipes) {
      ins.run(uuid(), r.name, r.title, r.description, r.sp, null, null, r.def ?? 0, nowTs, nowTs);
    }
  }

  // ---- Projects ----
  listProjects(): ProjectRow[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY name').all() as ProjectRow[];
  }
  getProject(id: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  }
  getProjectByPath(path: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as ProjectRow | undefined;
  }
  createProject(p: Omit<ProjectRow, 'id' | 'created_at' | 'updated_at'>): ProjectRow {
    const id = uuid();
    const t = now();
    this.db.prepare(
      `INSERT INTO projects (id,name,path,type,remote_url,created_by,badge_color,parent_group,setup_script,description,created_at,updated_at)
       VALUES (@id,@name,@path,@type,@remote_url,@created_by,@badge_color,@parent_group,@setup_script,@description,@created_at,@updated_at)`
    ).run({ ...p, setup_script: p.setup_script ?? null, description: p.description ?? null, id, created_at: t, updated_at: t });
    return this.getProject(id)!;
  }
  updateProject(id: string, patch: Partial<ProjectRow>): ProjectRow {
    const cols = Object.keys(patch).filter((k) => k !== 'id' && patch[k as keyof ProjectRow] !== undefined);
    if (cols.length > 0) {
      const set = cols.map((c) => `${c} = @${c}`).join(', ');
      this.db.prepare(`UPDATE projects SET ${set}, updated_at = @updated_at WHERE id = @id`)
        .run({ ...patch, updated_at: now(), id });
    }
    return this.getProject(id)!;
  }
  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  // ---- Missions ----
  listMissions(projectId?: string): MissionRow[] {
    return projectId
      ? this.db.prepare('SELECT * FROM missions WHERE project_id = ? ORDER BY created_at').all(projectId) as MissionRow[]
      : this.db.prepare('SELECT * FROM missions ORDER BY created_at').all() as MissionRow[];
  }
  getMission(id: string): MissionRow | undefined {
    return this.db.prepare('SELECT * FROM missions WHERE id = ?').get(id) as MissionRow | undefined;
  }
  /** Count missions currently running (or paused) for a project — used for the concurrency cap. */
  countRunningMissions(projectId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM missions WHERE project_id = ? AND state IN ('running','paused')")
      .get(projectId) as { n: number };
    return row.n;
  }
  createMission(m: Omit<MissionRow, 'id' | 'created_at' | 'updated_at'>): MissionRow {
    const id = uuid();
    const t = now();
    this.db.prepare(
      `INSERT INTO missions (id,project_id,name,objective,git_strategy,base_branch,worktree_path,
        driver_type,driver_profile,driver_model,driver_provider,driver_worktree_flag,uses_kanban,
        intervention,depends_on_mission_ids,max_concurrent,state,session_id,created_at,updated_at)
       VALUES (@id,@project_id,@name,@objective,@git_strategy,@base_branch,@worktree_path,
        @driver_type,@driver_profile,@driver_model,@driver_provider,@driver_worktree_flag,@uses_kanban,
        @intervention,@depends_on_mission_ids,@max_concurrent,@state,@session_id,@created_at,@updated_at)`
    ).run({ ...m, id, created_at: t, updated_at: t });
    return this.getMission(id)!;
  }
  updateMission(id: string, patch: Partial<MissionRow>): MissionRow {
    const cols = Object.keys(patch).filter((k) => k !== 'id' && patch[k as keyof MissionRow] !== undefined);
    if (cols.length > 0) {
      const set = cols.map((c) => `${c} = @${c}`).join(', ');
      this.db.prepare(`UPDATE missions SET ${set}, updated_at = @updated_at WHERE id = @id`)
        .run({ ...patch, updated_at: now(), id });
    }
    return this.getMission(id)!;
  }
  deleteMission(id: string): void {
    this.db.prepare('DELETE FROM missions WHERE id = ?').run(id);
  }

  // ---- Tasks ----
  listTasks(missionId: string): TaskRow[] {
    return this.db.prepare('SELECT * FROM tasks WHERE mission_id = ? ORDER BY sort_order').all(missionId) as TaskRow[];
  }
  /** Count tasks by state for a mission: { todo, doing, blocked, done }. */
  countTasksByState(missionId: string): Record<string, number> {
    // Count only top-level (parent) tasks — subtasks are children of an
    // orchestrator and shouldn't inflate the mission's state counters.
    const rows = this.db.prepare('SELECT state, COUNT(*) as n FROM tasks WHERE mission_id = ? AND parent_id IS NULL GROUP BY state').all(missionId) as Array<{ state: string; n: number }>;
    const out: Record<string, number> = { todo: 0, doing: 0, blocked: 0, done: 0 };
    for (const r of rows) out[r.state] = r.n;
    return out;
  }
  listAllTasks(): TaskRow[] {
    return this.db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC').all() as TaskRow[];
  }
  getTask(id: string): TaskRow | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  }

  /**
   * Global search across projects, missions, and tasks. Returns grouped
   * results so the Ctrl+K palette can render them by section.
   */
  searchAll(q: string): {
    projects: ProjectRow[];
    missions: MissionRow[];
    tasks: TaskRow[];
  } {
    const term = `%${q.trim().toLowerCase()}%`;
    const projects = this.db
      .prepare('SELECT * FROM projects WHERE lower(name) LIKE ? OR lower(path) LIKE ?')
      .all(term, term) as ProjectRow[];
    const missions = this.db
      .prepare('SELECT * FROM missions WHERE lower(name) LIKE ? OR lower(objective) LIKE ?')
      .all(term, term) as MissionRow[];
    const tasks = this.db
      .prepare('SELECT * FROM tasks WHERE lower(title) LIKE ? OR lower(description) LIKE ?')
      .all(term, term) as TaskRow[];
    return { projects, missions, tasks };
  }

  // ---- Subagent recipes (templates) ----
  listRecipes(): SubagentRecipeRow[] {
    return this.db.prepare('SELECT * FROM subagent_recipes ORDER BY is_default DESC, name').all() as SubagentRecipeRow[];
  }
  getRecipe(id: string): SubagentRecipeRow | undefined {
    return this.db.prepare('SELECT * FROM subagent_recipes WHERE id = ?').get(id) as SubagentRecipeRow | undefined;
  }
  createRecipe(r: Omit<SubagentRecipeRow, 'id' | 'created_at' | 'updated_at'>): SubagentRecipeRow {
    const id = uuid();
    const ts = now();
    this.db.prepare(
      `INSERT INTO subagent_recipes (id,name,title,description,system_prompt,profile,provider,model,is_default,created_at,updated_at)
       VALUES (@id,@name,@title,@description,@system_prompt,@profile,@provider,@model,@is_default,@created_at,@updated_at)`
    ).run({ ...r, id, created_at: ts, updated_at: ts });
    return this.getRecipe(id)!;
  }
  updateRecipe(id: string, patch: Partial<SubagentRecipeRow>): SubagentRecipeRow {
    const cols = Object.keys(patch).filter((k) => k !== 'id' && patch[k as keyof SubagentRecipeRow] !== undefined);
    if (cols.length > 0) {
      const set = cols.map((c) => `${c} = @${c}`).join(', ');
      this.db.prepare(`UPDATE subagent_recipes SET ${set}, updated_at = @updated_at WHERE id = @id`)
        .run({ ...patch, id, updated_at: now() });
    }
    return this.getRecipe(id)!;
  }
  deleteRecipe(id: string): void {
    this.db.prepare('DELETE FROM subagent_recipes WHERE id = ?').run(id);
  }

  createTask(t: Omit<TaskRow, 'id' | 'created_at' | 'updated_at' | 'run_state' | 'agent_provider' | 'agent_profile' | 'subagent_ids' | 'git_strategy' | 'branch' | 'base_branch' | 'spec' | 'driver_profile' | 'driver_model' | 'driver_provider' | 'worktree_path' | 'review_pr_project_id' | 'review_pr_number' | 'review_verdict' | 'is_fix_task' | 'retry_count' | 'pr_url'> & { run_state?: TaskRow['run_state']; agent_provider?: string | null; agent_profile?: string | null; subagent_ids?: string; git_strategy?: TaskRow['git_strategy']; branch?: string | null; base_branch?: string | null; spec?: string | null; driver_profile?: string | null; driver_model?: string | null; driver_provider?: string | null; worktree_path?: string | null; review_pr_project_id?: string | null; review_pr_number?: number | null; review_verdict?: TaskRow['review_verdict']; is_fix_task?: number; retry_count?: number; pr_url?: string | null }): TaskRow {
    const id = uuid();
    const ts = now();
    this.db.prepare(
      `INSERT INTO tasks (id,mission_id,title,description,spec,state,run_state,parent_id,depends_on,
        agent_type,agent_llm,agent_provider,agent_profile,agent_system_prompt,git_strategy,branch,base_branch,driver_profile,driver_model,driver_provider,worktree_path,subagent_ids,review_pr_project_id,review_pr_number,review_verdict,is_fix_task,retry_count,pr_url,sort_order,created_at,updated_at)
      VALUES (@id,@mission_id,@title,@description,@spec,@state,@run_state,@parent_id,@depends_on,
        @agent_type,@agent_llm,@agent_provider,@agent_profile,@agent_system_prompt,@git_strategy,@branch,@base_branch,@driver_profile,@driver_model,@driver_provider,@worktree_path,@subagent_ids,@review_pr_project_id,@review_pr_number,@review_verdict,@is_fix_task,@retry_count,@pr_url,@sort_order,@created_at,@updated_at)`
    ).run({
      ...t,
      spec: t.spec ?? null,
      agent_provider: t.agent_provider ?? null,
      agent_profile: t.agent_profile ?? null,
      run_state: t.run_state ?? 'idle',
      subagent_ids: t.subagent_ids ?? '[]',
      git_strategy: t.git_strategy ?? null,
      branch: t.branch ?? null,
      base_branch: t.base_branch ?? null,
      driver_profile: t.driver_profile ?? null,
      driver_model: t.driver_model ?? null,
      driver_provider: t.driver_provider ?? null,
      worktree_path: t.worktree_path ?? null,
      review_pr_project_id: t.review_pr_project_id ?? null,
      review_pr_number: t.review_pr_number ?? null,
      review_verdict: t.review_verdict ?? null,
      is_fix_task: t.is_fix_task ?? 0,
      retry_count: t.retry_count ?? 0,
      pr_url: t.pr_url ?? null,
      id, created_at: ts, updated_at: ts,
    });
    return this.getTask(id)!;
  }
  updateTask(id: string, patch: Partial<TaskRow>): TaskRow {
    const cols = Object.keys(patch).filter((k) => k !== 'id' && patch[k as keyof TaskRow] !== undefined);
    if (cols.length > 0) {
      const set = cols.map((c) => `${c} = @${c}`).join(', ');
      this.db.prepare(`UPDATE tasks SET ${set}, updated_at = @updated_at WHERE id = @id`)
        .run({ ...patch, id, updated_at: now() });
    }
    return this.getTask(id)!;
  }
  deleteTask(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  // ---- Agent runs & logs ----
  createAgentRun(r: Omit<AgentRunRow, 'id' | 'started_at'>): AgentRunRow {
    const id = uuid();
    this.db.prepare(
      `INSERT INTO agent_runs (id,mission_id,task_id,agent_type,role,llm,state,started_at,finished_at,exit_code,session_id)
       VALUES (@id,@mission_id,@task_id,@agent_type,@role,@llm,@state,@started_at,@finished_at,@exit_code,@session_id)`
    ).run({ ...r, id, started_at: now() });
    return this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow;
  }
  finishAgentRun(id: string, state: AgentRunRow['state'], exitCode?: number): void {
    this.db.prepare('UPDATE agent_runs SET state = ?, finished_at = ?, exit_code = ? WHERE id = ?')
      .run(state, now(), exitCode ?? null, id);
  }
  updateRunSessionId(id: string, sessionId: string): void {
    this.db.prepare('UPDATE agent_runs SET session_id = ? WHERE id = ?').run(sessionId, id);
  }
  listRunsForMission(missionId: string): AgentRunRow[] {
    return this.db.prepare('SELECT * FROM agent_runs WHERE mission_id = ? ORDER BY started_at').all(missionId) as AgentRunRow[];
  }
  listRunsForTask(taskId: string): AgentRunRow[] {
    return this.db.prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at').all(taskId) as AgentRunRow[];
  }
  listStaleActiveTasks(runStates: string[]): TaskRow[] {
    const placeholders = runStates.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM tasks WHERE run_state IN (${placeholders})`).all(...runStates) as TaskRow[];
  }

  /**
   * Tasks left in a `doing` state whose run_state is `idle` (no active run ever
   * recorded). A crash/restart can mark a task `doing` and then die before a
   * run is created, leaving the task stuck "in progress" with idle subtasks.
   * These are stale and safe for the watchdog to recover.
   */
  listTasksStuckDoing(): TaskRow[] {
    return this.db.prepare(`SELECT * FROM tasks WHERE state = 'doing' AND run_state = 'idle'`).all() as TaskRow[];
  }

  /** Aggregate task counts across all missions. */
  countTasks(): { total: number; active: number; done: number; failed: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN run_state NOT IN ('done','failed','idle') THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN run_state = 'done' OR state = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN run_state = 'failed' OR state = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM tasks
    `).get() as { total: number; active: number | null; done: number | null; failed: number | null };
    return {
      total: row.total,
      active: row.active ?? 0,
      done: row.done ?? 0,
      failed: row.failed ?? 0,
    };
  }
  listMissionsByState(state: string): MissionRow[] {
    return this.db.prepare('SELECT * FROM missions WHERE state = ?').all(state) as MissionRow[];
  }
  addLog(runId: string, level: 'info' | 'warn' | 'error' | 'debug', message: string, source: 'stdout' | 'stderr' | 'system' = 'system'): void {
    this.db.prepare(
      `INSERT INTO agent_log_entries (id,run_id,level,message,source,created_at) VALUES (?,?,?,?,?,?)`
    ).run(uuid(), runId, level, message, source, now());
  }
  listLogsForRun(runId: string) {
    return this.db.prepare('SELECT * FROM agent_log_entries WHERE run_id = ? ORDER BY created_at').all(runId);
  }
  /** All logs for a mission, each tagged with its task_id (via its run). */
  listLogsForMission(missionId: string) {
    return this.db.prepare(
      `SELECT l.*, r.task_id FROM agent_log_entries l
       JOIN agent_runs r ON l.run_id = r.id
       WHERE r.mission_id = ? ORDER BY l.created_at`
    ).all(missionId);
  }

  // ---- Events ----
  addEvent(ev: { missionId?: string; projectId?: string; taskId?: string; type: string; payload: unknown }): void {
    this.db.prepare(
      `INSERT INTO events (id,mission_id,project_id,task_id,type,payload,created_at) VALUES (?,?,?,?,?,?,?)`
    ).run(uuid(), ev.missionId ?? null, ev.projectId ?? null, ev.taskId ?? null, ev.type, JSON.stringify(ev.payload), now());
  }
  listEvents(missionId?: string, taskId?: string): Array<{
    id: string; type: string; payload: unknown; created_at: number; task_id: string | null; mission_id: string | null;
  }> {
    let sql = 'SELECT * FROM events';
    const cond: string[] = [];
    const args: string[] = [];
    if (missionId) { cond.push('mission_id = ?'); args.push(missionId); }
    if (taskId) { cond.push('task_id = ?'); args.push(taskId); }
    if (cond.length) sql += ` WHERE ${cond.join(' AND ')}`;
    sql += ' ORDER BY created_at DESC LIMIT 200';
    const rows = this.db.prepare(sql).all(...args) as Array<{ id: string; type: string; payload: string; created_at: number; task_id: string | null; mission_id: string | null }>;
    return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  // ---- Agent config ----
  listAgentConfig(): AgentConfigRow[] {
    return this.db.prepare('SELECT * FROM agent_config ORDER BY name').all() as AgentConfigRow[];
  }
  createAgentConfig(a: Omit<AgentConfigRow, 'id'>): AgentConfigRow {
    const id = uuid();
    this.db.prepare(
      `INSERT INTO agent_config (id,name,enabled,role,default_llm,profile,provider,system_prompt)
       VALUES (@id,@name,@enabled,@role,@default_llm,@profile,@provider,@system_prompt)`
    ).run({ ...a, id });
    return this.db.prepare('SELECT * FROM agent_config WHERE id = ?').get(id) as AgentConfigRow;
  }
  deleteAgentConfig(id: string): void {
    this.db.prepare('DELETE FROM agent_config WHERE id = ?').run(id);
  }
  updateAgentConfig(id: string, patch: Partial<AgentConfigRow>): void {
    const cols = Object.keys(patch).filter((k) => k !== 'id' && patch[k as keyof AgentConfigRow] !== undefined);
    if (cols.length === 0) return;
    const set = cols.map((c) => `${c} = @${c}`).join(', ');
    this.db.prepare(`UPDATE agent_config SET ${set} WHERE id = @id`).run({ ...patch, id });
  }

  // ---- Notifications ----
  listNotifications(): NotificationRow[] {
    return this.db.prepare('SELECT * FROM notifications ORDER BY created_at DESC').all() as NotificationRow[];
  }
  getNotification(id: string): NotificationRow | undefined {
    return this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as NotificationRow | undefined;
  }
  addNotification(n: { type: string; title: string; body: string; link?: string | null }): NotificationRow {
    const id = uuid();
    const created_at = now();
    // Truncate overlong title/body so the table can't grow unbounded rows.
    const title = n.title.slice(0, MAX_NOTIFICATION_TITLE_LENGTH);
    const body = n.body.slice(0, MAX_NOTIFICATION_BODY_LENGTH);
    this.db.prepare(
      `INSERT INTO notifications (id,type,title,body,read,link,created_at) VALUES (@id,@type,@title,@body,0,@link,@created_at)`
    ).run({ id, type: n.type, title, body, link: n.link ?? null, created_at });
    return this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as NotificationRow;
  }
  markNotificationRead(id: string): void {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  }
  markAllNotificationsRead(): void {
    this.db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  }
  deleteNotification(id: string): void {
    this.db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
  }
  countUnread(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').get() as { n: number };
    return row.n;
  }
  /**
   * Retention/cleanup: delete notifications older than `maxAgeMs` (default 30
   * days). Idempotent — safe to call on every startup and after each add.
   * Returns the number of rows pruned.
   */
  pruneNotifications(maxAgeMs: number = NOTIFICATION_RETENTION_MS): number {
    const cutoff = now() - maxAgeMs;
    const res = this.db.prepare('DELETE FROM notifications WHERE created_at < ?').run(cutoff);
    return res.changes;
  }

  // ---- Settings (key/value) ----
  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }
  setSetting(key: string, value: string): void {
    this.db.prepare(
      `INSERT INTO settings (key,value) VALUES (@key,@value)
       ON CONFLICT(key) DO UPDATE SET value = @value`
    ).run({ key, value });
  }
}
