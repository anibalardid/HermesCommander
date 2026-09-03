export type Project = {
  id: string;
  name: string;
  path: string;
  type: 'git' | 'folder';
  remote_url: string | null;
  created_by: 'open' | 'create' | 'clone';
  badge_color: string | null;
  parent_group: string | null;
  setup_script?: string | null;
  description?: string | null;
  branch?: string | null;
  created_at: number;
  updated_at: number;
};

export type Mission = {
  id: string;
  project_id: string;
  name: string;
  objective: string;
  git_strategy: 'worktree' | 'branch' | 'none';
  base_branch: string | null;
  worktree_path: string | null;
  driver_type: string;
  driver_profile: string | null;
  driver_model: string;
  driver_provider: string | null;
  driver_worktree_flag: number;
  uses_kanban: number;
  intervention: 'autonomous' | 'approve-steps' | 'manual';
  depends_on_mission_ids: string;
  max_concurrent: number | null;
  state: 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  session_id: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
  branch?: string | null;
};

export type Task = {
  id: string;
  mission_id: string;
  title: string;
  description: string | null;
  spec: string | null;
  state: 'todo' | 'doing' | 'blocked' | 'done';
  run_state: 'idle' | 'planning' | 'delegating' | 'running' | 'waiting' | 'waiting_review' | 'paused' | 'failed' | 'waiting_user' | 'done';
  parent_id: string | null;
  depends_on: string;
  agent_type: string | null;
  agent_llm: string | null;
  agent_provider: string | null;
  agent_profile: string | null;
  agent_system_prompt: string | null;
  sort_order: number;
  git_strategy: 'worktree' | 'branch' | 'none' | null;
  branch: string | null;
  base_branch: string | null;
  driver_profile: string | null;
  driver_model: string | null;
  driver_provider: string | null;
  worktree_path: string | null;
  subagent_ids: string;
  review_pr_project_id: string | null;
  review_pr_number: number | null;
  review_verdict?: 'pass' | 'needs_changes' | 'reject' | null;
  is_fix_task?: number;
  pr_url?: string | null;
  retry_count?: number;
  created_at: number;
  updated_at: number;
};

export type AgentRun = {
  id: string;
  mission_id: string;
  task_id: string | null;
  agent_type: string;
  role: 'driver' | 'subagent';
  llm: string | null;
  state: 'running' | 'done' | 'failed' | 'interrupted';
  started_at: number;
  finished_at: number | null;
  exit_code: number | null;
  session_id: string | null;
};

export type AgentLogEntry = {
  id: string;
  run_id: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source: 'stdout' | 'stderr' | 'system';
  created_at: number;
  task_id?: string | null;
};

export type AgentConfig = {
  id: string;
  name: string;
  enabled: number;
  role: 'driver' | 'subagent' | 'both';
  default_llm: string | null;
  profile: string | null;
  provider: string | null;
  system_prompt: string | null;
};

export type SubagentRecipe = {
  id: string;
  name: string;
  title: string;
  description: string;
  system_prompt: string;
  profile: string | null;
  provider: string | null;
  model: string | null;
  is_default: number;
};

export type DevPrompt = {
  id: string;
  name: string;
  prompt: string;
  type: string;
  contributor: string | null;
};

export type FsEntry = {
  name: string;
  path: string;
  type: 'dir' | 'file';
  isGitRepo?: boolean;
  /** Current branch of a git repo (or worktree). Populated when isGitRepo. */
  branch?: string | null;
};

export type MissionDetail = {
  mission: Mission;
  tasks: Task[];
  runs: AgentRun[];
};

// ---- Workspace panel: source control + file browser ----

export type FileStatus = {
  path: string;
  code: string;      // M, A, D, R, ??
  staged: boolean;
};

export type PullRequest = {
  number: number;
  title: string;
  state: string;
  branch: string;
  url: string;
};

export type SourceStatus = {
  branch: string | null;
  /** The repo's default/base branch (e.g. main/master). When branch === baseBranch,
   *  a PR can't be opened (head == base) — the UI shows Revert Changes instead. */
  baseBranch: string | null;
  worktreePath: string | null;
  files: FileStatus[];
  ahead: number;
  behind: number;
  prs: PullRequest[];
  ghAvailable: boolean;
  remoteUrl: string | null;
  /** Populated by the API layer (project & mission & task scopes). */
  worktrees?: Array<{ path: string; branch: string | null; current: boolean }>;
  branches?: Array<{ name: string; current: boolean }>;
  /** Populated by the task scope: an existing open PR for the task's branch. */
  pr?: { url: string; number: number; projectId: string | null } | null;
};

export type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  protected?: boolean;
};

export type WorktreeInfo = {
  path: string;
  branch: string | null;
  current: boolean;
};

export type BranchInfo = {
  name: string;
  current: boolean;
};

export type CommitInfo = {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  files: Array<{ path: string; code: string }>;
};

export type HermesSession = {
  id: string;
  source: string;
  title: string;
  preview: string;
  model: string;
  last_active?: number;
};

// ---- GitHub PRs (Tasks page) ----
export type PrState = 'OPEN' | 'CLOSED' | 'MERGED' | 'DRAFT';

export type GithubPr = {
  projectId: string;
  projectName: string;
  number: number;
  title: string;
  state: PrState;
  branch: string | null;
  base: string | null;
  url: string;
  author: string | null;
  updatedAt: string | null;
  additions: number | null;
  deletions: number | null;
  mergeable: string | null;
};

export type PrComment = {
  id: string;
  author: string;
  body: string;
  createdAt: string | null;
  path: string | null;
  isStale: boolean | null;
};

export type PrReviewer = {
  login: string;
  state: string | null;
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

export type PrCommentThread = {
  id: string;
  path: string | null;
  isResolved: boolean | null;
  comments: PrComment[];
};

export type GithubPrDetail = GithubPr & {
  body: string;
  comments: PrComment[];
  commentThreads: PrCommentThread[];
  reviewers: PrReviewer[];
  assignees: PrAssignee[];
  files: PrFile[];
};

// ---- Problematic tasks (Resume section) ----
export type ProblematicTask = {
  task: Task;
  missionName: string | null;
  missionId: string;
  projectName: string | null;
  projectId: string;
};

// ---- Notifications (bell + panel) ----
export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  read: number;
  link: string | null;
  created_at: number;
};


