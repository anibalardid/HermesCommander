# 02 — Data Model

Entities and fields. Persistence: SQLite (`better-sqlite3`), simple migrations.
Code is always in English; UI strings are localized separately (see `04-frontend.md`).

## Project

Represents a repo/folder on the computer. Created by opening an existing folder,
creating a new one, or cloning a repo.

```
Project {
  id: string (uuid)
  name: string
  path: string             // absolute path on the host
  type: 'git' | 'folder'   // is it a git repo or a plain folder?
  remoteUrl?: string       // if cloned
  createdBy: 'open' | 'create' | 'clone'
  badgeColor?: string
  parentGroupId?: string   // if part of a project group (see below)
  createdAt: number
  updatedAt: number
}
```

### Project groups (nested repos in a parent folder)

When opening a folder that is not a git repo but contains
several git repos, the user chooses to **group** them under one parent project
or add them **individually**. A group is a lightweight container:

```
ProjectGroup {
  id: string (uuid)
  name: string            // the parent folder name
  path: string            // parent folder path
  projectIds: string[]    // the repos it groups
  createdAt: number
}
```

When `type: 'folder'` (plain folder with no nested git), it becomes a single
project of type `folder` (a synthetic root workspace, no git checkout).

## Mission

A pure container. A mission is just a name + description; the
orchestrator config lives on each **parent task** inside its board.

```
Mission {
  id: string (uuid)
  projectId: string
  name: string
  objective: string         // description / container text

  // ---- State (kept for lifecycle) ----
  state: 'pending' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
  sessionId?: string        // persisted Hermes session
  createdAt: number
  updatedAt: number
}
```

## Task (parent = orchestrator)

Parent tasks carry the full orchestrator config. Subtasks inherit it
via `resolveTaskConfig` in the runner.

```
Task {
  id: string (uuid)
  missionId: string
  title: string
  description: string       // the prompt/spec
  state: 'todo' | 'doing' | 'blocked' | 'done'
  runState: 'idle' | 'planning' | 'delegating' | 'running' | 'waiting' |
            'waiting_review' | 'paused' | 'failed' | 'waiting_user' | 'done'
  parentId?: string         // subtask of an orchestrator parent
  dependsOn: string[]       // task ids

  // ---- Orchestrator config (parent tasks only) ----
  gitStrategy: 'worktree' | 'branch' | 'none'
  driver: { profile?, model, provider? }   // Hermes orchestrator
  worktreePath?: string     // if gitStrategy === 'worktree'
  subagentIds: string[]     // selected subagent recipes
  branch?: string           // git branch for the task
  baseBranch?: string       // base branch a fix task derives from (PR head)

  // ---- Review / PR integration ----
  reviewPrProjectId?: string  // project of the PR being reviewed
  reviewPrNumber?: number     // PR number being reviewed
  reviewVerdict?: string      // 'approved' | 'needs_changes' | ...
  prUrl?: string              // PR created for this task
  retryCount: number          // how many times the task was retried

  // ---- Per-subtask agent (from recipe) ----
  agentType?: string
  agentLlm?: string
  agentProvider?: string
  agentSystemPrompt?: string
  agentProfile?: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}
```

## Agent Run / History (detailed telemetry)

Every execution of an agent (driver or subagent) is tracked with its own log
and history. Answer 2: **detailed logs + per-task & per-agent history**.

```
AgentRun {
  id: string (uuid)
  missionId: string
  taskId?: string           // null for the driver agent
  agentType: string         // hermes/codex/opencode/claude
  role: 'driver' | 'subagent'
  llm: string
  state: 'running' | 'done' | 'failed' | 'interrupted'
  startedAt: number
  finishedAt?: number
  exitCode?: number
  sessionId?: string
}

AgentLogEntry {
  id: string
  runId: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  source: 'stdout' | 'stderr' | 'system'
  createdAt: number
}
```

> Task history: each `AgentRun` linked to a `taskId` provides the history for
> that task; `role: 'driver'` runs provide the mission-level history.

## Event

Activity log pushed live over WebSocket.

```
Event {
  id: string
  missionId?: string
  projectId?: string
  type: 'log' | 'task_created' | 'task_status' | 'agent_msg' | 'state_change' | 'error'
  payload: string   // JSON
  createdAt: number
}
```

## Agents Config (configuration screen)

Enable/disable available agents as drivers and/or subagents.

```
AgentConfig {
  id: string
  name: string            // hermes | codex | opencode | claude
  enabled: boolean
  role: 'driver' | 'subagent' | 'both'
  defaultLlm?: string
  systemPrompt?: string
}
```

## Notification

In-app notification shown in the bell (top-right, on every screen).

```
Notification {
  id: string
  title: string
  body: string
  read: 0 | 1
  createdAt: number
}
```

## Setting

Key/value persisted settings (e.g. notification sound).

```
Setting {
  key: string            // e.g. 'notifications.sound'
  value: string          // 'true' | 'false' | ...
}
```

## Relations

```
Project       1───* Mission
ProjectGroup  1───* Project
Mission       1───* Task
Task          0───* Task      (parent/child via parentId)
Task          *───* Task      (dependencies via dependsOn)
Mission       1───* AgentRun
AgentRun      1───* AgentLogEntry
Mission       1───* Event
Project       1───* Event
```

## Kanban note

The kanban board is **built 100% in this project** (nothing embedded from Hermes
or other tools). The `Task` table is the single source of truth for the board UI. The
orchestrator (Hermes) drives the board by delegating tasks, and Hermes Commander
captures that via the mission runtime (see `03-mission-runtime.md`). The board
renders the task tree (subtasks + dependencies), each task's state, and links to
its logs/agent runs. A mission is a **container** — it has no start/pause/stop;
each parent (orchestrator) task is run individually from the board.
