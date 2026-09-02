# 07 — Decisions & Open Questions

## Resolved decisions

### Kanban board
- **Built 100% in this project.** Nothing embedded from Hermes. The
  `Task` table is the single source of truth for the board UI.

### Telemetry detail
- **Detailed.** Logs + history per task and per agent (see `AgentRun` /
  `AgentLogEntry` in `02-data-model.md`).

### Scope / phases
- **Full project build — no MVP phases.** Everything is implemented (kanban,
  worktrees, missions, telemetry, intervention, i18n, dark/light UI).

### Concurrency
- **Cap of 5 concurrent missions per project.**

### Intervention & kanban interaction
- **Pause / resume / stop + redirect / message** the agent. Full interactive
  control via tmux.
- On the kanban, each task shows its **subtasks, parent/dependencies, state, and
  links to its logs**. The user can **view**, **pause**, or **fully stop** a
  mission from the board (read-only editing of task state — the orchestrator
  owns the board).

### Language
- Code & documentation always in **English**.
- UI is **multi-language**: English + Spanish via `react-i18next` (most used),
  default English.

### UI kit
- **shadcn-style** component kit built in-project (radix-ui + tailwind + lucide
  icons), with **dark/light mode** via CSS variables.

### Client state
- **Zustand** (most used for realtime-synced state). Source of truth is the
  backend.

### Project creation
- 3 modes: **open** local folder / **create** new / **clone** repo,
  with a folder combo+search picker.

### Nested repos / project groups (answer 4)
- When opening a folder that is not a git repo but contains
  several git repos, **scan and show a review dialog** where the user chooses to
  **group** them under one parent project or add them **individually**. A plain
  folder with no git becomes a single `folder` project.

### Auth (P1)
- **Tailscale only, no login.** Single-user, protected by the private network.

### Mission cap (P2)
- **Default of 5 concurrent per project, editable per mission** in the mission
  config (soft default, not a hard cap).

### Cross-mission dependency UX (P3)
- **Structured selector** on mission creation: "depends on mission X". The
  dependency is stored as a reference and injected as context when spawning.

### Daemon packaging (P4)
- **Document both**: launchd (macOS) + a simple background start script (Linux).

### Project group editing (P5)
- **Fixed at creation** for v1 (not editable later).

### Kanban editing (P6)
- **View-only from the phone.** The orchestrator owns the board; the user can
  view, pause, or fully stop a mission, but does not move tasks.

## Remaining open questions

- None blocking the build. All architecture, data-model, UX, i18n, and
  packaging decisions are resolved.
