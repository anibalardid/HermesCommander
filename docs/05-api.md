# 05 — API (REST + WebSocket contract)

Backend: Fastify (Node/TS). Access over Tailscale. All routes under `/api`.
Code and docs in English; UI strings localized.

## REST

### Projects & groups
- `GET /api/projects` → list all
- `GET /api/projects/:id` → detail + missions
- `POST /api/projects` → create (open | create | clone | group)
  ```
  body: { action: 'open'|'create'|'clone'|'group',
          path?: string,      // open
          newPath?: string,   // create
          cloneUrl?: string,  // clone
          destination?: string,// clone
          name?: string,
          group?: boolean }   // if scanning a folder with nested git repos
  ```
- `POST /api/projects/scan` → scan a folder for nested git repos (review dialog)
  ```
  body: { path: string }
  response: { isGitRepo, nestedRepos: [{name, path}] , isFolderRepo }
  ```
- `POST /api/projects/group` → group scanned repos under one parent
  ```
  body: { groupName, path, projectIds: string[] }
  ```
- `DELETE /api/projects/:id`
- `DELETE /api/projects/groups/:id`

### Missions
- `GET /api/missions?projectId=` → list
- `POST /api/missions` → create (name + objective only — a container)
- `GET /api/missions/:id` → detail + tasks + agent runs (+ `branch`)
- `PATCH /api/missions/:id` → update name/objective
- `POST /api/missions/:id/start`
- `POST /api/missions/:id/pause`
- `POST /api/missions/:id/resume`
- `POST /api/missions/:id/stop`
- `POST /api/missions/:id/interrupt` → `{ message }` (redirect the agent)
- `DELETE /api/missions/:id`

### Tasks (kanban, own)
- `GET /api/missions/:id/tasks` → board tree (subtasks + dependencies)
- `GET /api/tasks/:id` → task detail + subtasks + dependencies + logs
- `POST /api/missions/:id/tasks` → create a task. Parent (orchestrator) tasks
  accept the orchestrator config: `{ title, description, gitStrategy, driver:
  {profile, model, provider}, subagentIds, baseBranch }`.
- `PATCH /api/tasks/:id` → update state / title / description / agent / driver /
  gitStrategy / subagentIds
- `DELETE /api/tasks/:id` → delete a task (and its subtasks via cascade)
- `POST /api/tasks/:id/run` → run a task as its own subagent
- `POST /api/tasks/:id/stop` → stop a running task
- `POST /api/tasks/:id/plan` → create the parent task's worktree (if worktree
  strategy) and materialize its subtasks via the planner. Requires ≥1 subagent.
- `POST /api/tasks/:id/pr` → create a PR for the task's branch (fix tasks can
  target a new branch derived from the PR's base branch). Returns `{ url }`.
- `GET /api/tasks/:id/source` → git status for the task's worktree
- `POST /api/tasks/:id/source/commit` → `{ message }` → commit in the task worktree
- `POST /api/tasks/:id/source/push` → push the task's branch
- `POST /api/tasks/:id/source/revert` → revert uncommitted changes
- `POST /api/tasks/:id/source/checkout` → `{ branch }` → checkout a branch
- `GET /api/tasks/:id/source/commits` → recent commits in the task worktree
- `POST /api/missions/:id/tasks/sync` → reconcile task state with the runner

### Telemetry / history
- `GET /api/missions/:id/runs` → agent runs for the mission
- `GET /api/tasks/:id/runs` → agent runs for a task (task history)
- `GET /api/runs/:id/logs` → log entries for an agent run
- `GET /api/agents/:name/logs` → all logs for an agent type (agent history)

### Workspace panel — source control
- `GET /api/missions/:id/source` → git status: `{ branch, worktreePath, files:
  [{path, code, staged}], ahead, behind, prs: [{number,title,state,branch,url}],
  ghAvailable, remoteUrl }`. PRs listed via `gh` when available; commit/push always
  work with pure git.
- `POST /api/missions/:id/source/commit` → `{ message }` → `git add -A` + commit.
  Returns `{ sha }`.
- `POST /api/missions/:id/source/push` → push current branch to origin. Returns `{ ok }`.
- `POST /api/missions/:id/source/pr` → `{ title, body? }` → `gh pr create`. Requires
  GitHub CLI; returns `{ url }` or a readable error.
- `GET /api/missions/:id/source/diff?file=` → unified diff for a file vs HEAD.

### Workspace panel — file browser
- `GET /api/missions/:id/files?path=` → list directory entries (dirs + files) under the
  mission's working dir. Root is the project path (or worktree). **Cannot escape the root.**
- `GET /api/missions/:id/files/content?path=` → text content of a file (≤200KB, text only).

### Agents Config
- `GET /api/agents-config`
- `PATCH /api/agents-config/:id`

### Hermes (orchestrator introspection)
- `GET /api/hermes/profiles` → Hermes profiles: `{ profiles: [{ name, model,
  provider, online }] }` (used to show the orchestrator's inherited provider/model).
- `GET /api/hermes/providers` → available providers
- `GET /api/hermes/models` → available models
- `GET /api/hermes/skills` → available skills
- `GET /api/hermes/mcp` → MCP servers
- `GET /api/hermes/sessions` → Hermes sessions
- `POST /api/hermes/chat` → `{ message }` → quick chat with the orchestrator

### Notifications
- `GET /api/notifications` → `{ notifications: [...], unread: number }`
- `POST /api/notifications/:id/read` → mark one as read
- `POST /api/notifications/read-all` → mark all as read
- `DELETE /api/notifications/:id` → dismiss one

### Settings
- `GET /api/settings/notifications` → `{ sound: boolean }`
- `PATCH /api/settings/notifications` → `{ sound: boolean }` → persist the toggle

### Live status / watchdog
- `GET /api/live-status` → `{ ... }` runner live status (polled by the frontend
  every ~5s via AJAX — never reloads the page)
- `POST /api/watchdog` → run the watchdog (reconcile stuck `doing` tasks)

### Health
- `GET /api/health` → `{ apiOnline, hermesOnline, profiles: [{ name, online }] }`

### Dashboard home — stats & resume
- `GET /api/stats` → `{ total, active, done, failed }` task counters.
- `GET /api/tasks/problematic` → tasks needing attention (state `blocked` or a
  failed run), enriched with mission + project: `{ tasks: [{ task, missionName,
  missionId, projectName, projectId }] }`.

### GitHub Tasks — PRs across all projects
Requires `gh` authenticated. Operates on the registered project repos.
- `GET /api/prs` → PRs from every project: `{ prs: [{ projectId, projectName,
  number, title, state, branch, base, url, author, updatedAt, additions,
  deletions, mergeable }] }`. Non-git projects and repos without `gh` are skipped.
- `GET /api/projects/:id/prs/:number` → full detail: `{ pr: { ...summary, body,
  comments: [{ id, author, body, createdAt, path, isStale }] } }`.
- `POST /api/projects/:id/prs/:number/merge` → `{ method: 'merge'|'squash'|'rebase' }`
  → merges the PR and deletes its branch. Returns `{ ok }`.
- `POST /api/projects/:id/prs/:number/state` → `{ closed: boolean }` →
  close or reopen the PR. Returns `{ ok }`.
- `POST /api/projects/:id/prs/:number/comment` → `{ body }` → post a top-level
  comment. Returns `{ ok }`.
- `POST /api/projects/:id/prs/:number/worktree` → `{ branch }` → create an
  isolated worktree on the PR's head branch (in `~/.hermes-commander-wt/pr-<n>-<branch>`).
  Returns `{ ok, path }`.

## WebSocket (`/ws`)

Client subscribes and receives live events. Channels:
- `office` — global state (all projects/missions)
- `project:<id>` — project events
- `mission:<id>` — mission events (logs, tasks, state, subagents)

Event:
```
{ id, type: 'log'|'task_created'|'task_status'|'agent_msg'|'state_change'|'error',
  missionId?, projectId?, payload, createdAt }
```

Example flow: user creates a mission → `POST /api/missions` → Runner spawns
hermes → pushes `state_change` (running) → tasks → `task_created` → the phone
animates live.
