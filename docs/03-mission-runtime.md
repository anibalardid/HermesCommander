# 03 — Mission Runtime (spawn Hermes per mission)

## Why Hermes as orchestrator

Hermes is the **only** agent that exposes live orchestration telemetry
(persisted sessions, transcripts, delegate_task, native kanban). Codex/OpenCode
delegate internally but expose little telemetry outward. So Hermes is ALWAYS the
orchestrator, and Codex/OpenCode/Claude are **executors** that Hermes calls with
`delegate_task`.

## Spawn a hermes process per mission

Each active mission = 1 isolated `hermes` subprocess, launched by the **Mission
Runner** with the flags chosen on the mission.

```bash
hermes -p <profile> -m <model> --provider <provider> -w <worktree> chat -q "<objective>"
```

Verified Hermes CLI flags:

- `-p/--profile <name>` — Hermes profile (isolates config/sessions/skills/memory).
- `-m/--model <model>` — model, e.g. `deepseek-v4-flash:cloud`.
- `--provider <provider>` — force provider (custom/openrouter/ollama/...).
- `-w/--worktree` — git worktree mode (parallel agents without conflicts).
- `chat -q "<objective>"` — non-interactive query (one-shot).
- Programmatic integration flags:
  - `--quiet` (`-Q`) — clean, parseable output.
  - `--source tool` — stays out of user-facing session lists.
  - `--max-turns N` — cap iterations (avoid loops in autonomous mode).

The first output line is the `session_id`, persisted on the mission to resume
(`hermes chat --resume <session_id> -q "..."`).

## Process lifecycle

```
MISSION (state)
  pending → running → paused ⇄ running → done | failed | cancelled

Mission Runner:
  - spawn(): start hermes, save session_id
  - pause(): SIGSTOP / signal the process
  - resume(): SIGCONT
  - interrupt(msg): send message to agent (stdin / tmux send-keys)
  - stop(): SIGTERM/SIGKILL
  - onExit(): update mission state
```

For interactive intervention (needed to "redirect"/message the agent mid-work),
**tmux** is used as a PTY layer (pattern documented in the Hermes CLI). The
Mission Runner keeps one tmux session per mission and uses `tmux send-keys` to
redirect the agent.

## Telemetry capture → Tasks & Agent Runs (detailed)

The Runner reads process stdout/stderr and converts them into `Event`s and
`AgentLogEntry`s. When Hermes delegates (`delegate_task`), Hermes Commander records:

- A `Task` (title/state) in the mission's own kanban (`Task` table).
- An `AgentRun` (role subagent/driver, agentType, llm, state).
- `AgentLogEntry` rows streamed from the subprocess output.

This gives **per-task and per-agent history** (answer 2) directly in the app —
no dependency on an external kanban.

## Concurrency

Multiple missions in parallel, **default cap of 5 per project, editable per
mission** (answer P2: soft default, not hard). The Mission Runner uses a
**worker pool**: each orchestrator (parent) task = 1 subprocess + 1 worktree.
A global concurrency cap (config) can also be set to protect host CPU/RAM.

## Worktrees (per parent task)

Worktrees are created per **orchestrator (parent) task**, not per mission. They
live **outside the project folder** (one level up, `~/Projects/.hermes-commander-wt/
<name>`) so they don't show up as untracked files inside the repo. The project's
`setup_script` runs inside each fresh worktree before any subagent works there.
Subtasks work directly in the parent task's worktree via `cwd` (never `-w`).

## Cross-mission dependencies

An orchestrator may depend on other missions/projects. Expressed via a
**structured selector** on mission creation (`dependsOnMissionIds`, answer P3).
When spawning, the objective is injected with a reference to the output/state
of each depended mission (via `context_from` / transcript / summary of the
prior mission).

## Daemon restart resilience

If the daemon restarts mid-mission, missions that were `running` auto-resume via
`hermes --resume <session_id>`; others stay in `paused` for the user to resume.

## Task lifecycle (orchestrator + subtasks)

A top-level task (no `parent_id`) is an **orchestrator**. It never applies
changes itself — it plans and delegates. Its lifecycle:

```
todo → (plan) → idle → (run) → doing/delegating → done | blocked
```

### Decision flow

```
                    ┌─────────────────────────────┐
                    │  NEW TASK (todo)            │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │  "Generate plan & subtasks" │
                    └──────────────┬──────────────┘
                                   │  POST /api/tasks/:id/plan
                                   ▼
                          ┌────────────────┐
                          │  Plan succeeds?│
                          └───┬────────┬───┘
                              │        │
                            YES        NO
                              │        │
                              ▼        ▼
                    ┌──────────────┐  ┌──────────────────────────┐
                    │  idle        │  │  blocked / failed        │
                    │  (subtasks   │  │  (failure reason shown)  │
                    │   created)   │  └───────────┬──────────────┘
                    └──────┬───────┘              │
                           │                      │
                           │  Play                │  Retry (re-plan, feeds
                           ▼                      │  previous error as ctx)
                    ┌──────────────┐              │  or Delete
                    │  doing/      │              │
                    │  delegating  │              │
                    └──────┬───────┘              │
                           │                      │
                           ▼                      │
                    ┌────────────────┐            │
                    │  All subtasks  │            │
                    │  done?        │            │
                    └───┬────────┬───┘            │
                        │        │                │
                      YES        NO               │
                        │        │                │
                        │        └──► (keep delegating)
                        ▼
                 ┌──────────────┐
                 │  done        │
                 └──────┬───────┘
                        │
                        ▼
              ┌─────────────────────┐
              │  Is it a review?    │
              └───┬─────────────┬───┘
                  │             │
                YES             NO
                  │             │
                  ▼             ▼
        ┌─────────────────┐  ┌──────────────────────┐
        │  Verdict?       │  │  Create PR (commit + │
        │  PASS / NEEDS   │  │  push + open)        │
        │  CHANGES/REJECT │  │  or Delete           │
        └───┬─────────┬───┘  └──────────────────────┘
            │         │
          PASS      NEEDS/REJECT
            │         │
            ▼         ▼
   ┌──────────────┐  ┌──────────────────────────────┐
   │  Comment +   │  │  Create fix task (reuses the │
   │  open PR     │  │  review's worktree/branch)   │
   └──────────────┘  │  + add comment               │
                     └──────────────────────────────┘
```

1. **Plan** (`POST /api/tasks/:id/plan`): the runner calls the Hermes planner
   (`runPlanner`) with the task's title + description as the objective. The
   planner returns a JSON `{spec, subtasks:[...]}`; each subtask is created as
   a child task assigned to a subagent recipe. The planner is restricted to the
   subagent recipes the user pre-selected on the task (`subagent_ids`); if none
   were chosen, all recipes are available. The overall spec (SDD) is stored on
   the parent task. Planning runs in the background (`run_state: 'planning'`).
2. **Run** (`POST /api/tasks/:id/run`): the orchestrator is marked
   `doing/delegating`, plans if it has no subtasks yet, then delegates each
   subtask in dependency order (parallel where independent). Subtasks work in
   the parent's worktree via `cwd`.
3. **Done**: when all subtasks are done, the orchestrator is marked `done`.
4. **Blocked/failed**: if the plan fails or a subtask fails, the orchestrator is
   marked `blocked` with `run_state: 'failed'` and the failure reason is
   recorded. The UI shows a **Retry** button (re-runs the planner, feeding the
   previous error output back as context) and a **Delete** button. A blocked
   task never shows commit/push.

### Planner timeout

The planner runs `hermes chat` with a **5-minute timeout** (`300000` ms). The
model can take 2+ minutes to produce a full breakdown, so a shorter timeout
(e.g. 2 minutes) caused the plan to fail spuriously and the task to land in
`blocked/failed` even though the retry itself worked.

### PR review tasks

A task with `review_pr_project_id` + `review_pr_number` is a **review**. When
it completes, the runner extracts a structured verdict (`PASS` / `NEEDS CHANGES`
/ `REJECT`) from the report and stores it in `review_verdict`. The UI then
offers, based on the verdict:

- **PASS** → post a comment to the PR and open it.
- **NEEDS CHANGES / REJECT** → **Create fix task** (reuses the review's
  worktree/branch so the fix lands on the same PR branch) and add a comment.

### Done task actions

A done task with its own worktree/branch shows **Create PR** (commits + pushes
+ opens the PR) and **Delete**. A done review task shows the verdict + comment
actions instead of Create PR.
