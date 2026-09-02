import { randomUUID } from 'node:crypto';

/** SQLite schema for Hermes Commander. Mirrors docs/02-data-model.md. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  path          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('git','folder')),
  remote_url    TEXT,
  created_by    TEXT NOT NULL CHECK (created_by IN ('open','create','clone')),
  badge_color   TEXT,
  parent_group  TEXT,
  setup_script  TEXT,
  description   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS missions (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  objective            TEXT NOT NULL,
  git_strategy         TEXT NOT NULL CHECK (git_strategy IN ('worktree','branch','none')),
  base_branch          TEXT,
  worktree_path        TEXT,
  driver_type          TEXT NOT NULL,
  driver_profile       TEXT,
  driver_model         TEXT NOT NULL,
  driver_provider      TEXT,
  driver_worktree_flag INTEGER DEFAULT 0,
  uses_kanban          INTEGER DEFAULT 1,
  intervention         TEXT NOT NULL DEFAULT 'autonomous' CHECK (intervention IN ('autonomous','approve-steps','manual')),
  depends_on_mission_ids TEXT NOT NULL DEFAULT '[]',
  max_concurrent       INTEGER,
  state                TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','paused','done','failed','cancelled')),
  session_id           TEXT,
  created_at           INTEGER NOT NULL,
  started_at           INTEGER,
  finished_at          INTEGER,
  updated_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  spec        TEXT,
  state       TEXT NOT NULL DEFAULT 'todo' CHECK (state IN ('todo','doing','blocked','done')),
  run_state   TEXT NOT NULL DEFAULT 'idle' CHECK (run_state IN ('idle','planning','delegating','running','waiting','waiting_review','paused','failed','waiting_user','done')),
  parent_id   TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on  TEXT NOT NULL DEFAULT '[]',
  agent_type  TEXT,
  agent_llm   TEXT,
  agent_provider TEXT,
  agent_profile TEXT,
  agent_system_prompt TEXT,
  -- Orchestrator (parent) task config. Only set on parent tasks.
  git_strategy     TEXT CHECK (git_strategy IN ('worktree','branch','none')),
  branch           TEXT,
  base_branch      TEXT,
  driver_profile   TEXT,
  driver_model     TEXT,
  driver_provider  TEXT,
  worktree_path    TEXT,
  subagent_ids     TEXT NOT NULL DEFAULT '[]',
  -- Optional PR-review linkage: when a task was created from a PR, record the
  -- project + PR number so the UI can offer "add comment to PR" once done.
  review_pr_project_id  TEXT,
  review_pr_number      INTEGER,
  review_verdict        TEXT CHECK (review_verdict IN ('pass','needs_changes','reject')),
  retry_count  INTEGER NOT NULL DEFAULT 0,
  pr_url       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  agent_type  TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('driver','subagent')),
  llm         TEXT,
  state       TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running','done','failed','interrupted')),
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  exit_code   INTEGER,
  session_id  TEXT
);

CREATE TABLE IF NOT EXISTS agent_log_entries (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  level       TEXT NOT NULL CHECK (level IN ('info','warn','error','debug')),
  message     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('stdout','stderr','system')),
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT REFERENCES missions(id) ON DELETE CASCADE,
  project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
  task_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('log','task_created','task_status','agent_msg','state_change','error')),
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_config (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  enabled         INTEGER NOT NULL DEFAULT 1,
  role            TEXT NOT NULL DEFAULT 'both' CHECK (role IN ('driver','subagent','both')),
  default_llm     TEXT,
  profile         TEXT,
  provider        TEXT,
  system_prompt   TEXT
);

CREATE TABLE IF NOT EXISTS subagent_recipes (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,      -- slug key, e.g. 'reviewer'
  title           TEXT NOT NULL,              -- single title (user-written, not translated)
  description     TEXT NOT NULL,              -- single description (not translated)
  system_prompt   TEXT NOT NULL,
  profile         TEXT,                       -- null = inherit orchestrator
  provider        TEXT,                       -- null = inherit orchestrator
  model           TEXT,                       -- null = inherit orchestrator
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

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
`;

export function now(): number {
  return Date.now();
}

export function uuid(): string {
  return randomUUID();
}
