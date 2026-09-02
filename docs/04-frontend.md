# 04 — Frontend (UI)

PWA React (Vite). Access over Tailscale from phone/tablet/desktop.

## UI Kit (shadcn-style)

We build a modern, self-contained component kit **in this project** — shadcn/ui
philosophy (copy the components you need, no opaque dependency), not an embedded
third-party app. Approach:

- **Component base**: `radix-ui` primitives + `tailwindcss` + `clsx`/`tailwind-merge`.
- **Components**: button, card, dialog, dropdown, input, select, tabs, badge,
  toast, sheet, avatar, tooltip, skeleton, switch, progress, etc. (shadcn-style).
- **Theming**: **dark/light mode** via CSS variables (shadcn token system),
  with a system toggle. Icons via `lucide-react`.
- **Visual style**: clean, modern, good spacing, responsive for touch.

> The full project is built — no MVP phases. This kit is part of the deliverable.

## i18n (multi-language UI)

UI strings are English + Spanish. Code, identifiers and docs stay in English.

- **Library**: `react-i18next` (most used, industry standard).
- **Structure**:
  ```
  src/i18n/
    locales/
      en/   → translation.json
      es/   → translation.json
    index.ts   → i18n init
  ```
- **Keys**: dot-namespaced, e.g. `missions.create.title`, `office.activeMissions`.
- **Default**: English. Language switch stored in localStorage / user setting.
- No translation needed for code identifiers, git messages, agent output —
  only for the user-facing UI chrome.

## State management

- **Zustand** (most used for realtime-synced state, less boilerplate than
  Context). Client state synced with backend via WS.
- Source of truth is the backend.

## Layout: 3-column desktop-style workspace (responsive)

The UI mirrors a desktop workspace even though it is a web PWA. Three
columns instead of full-screen stacked screens — so you can see something
without losing context.

```
┌───────────────┬──────────────────────┬───────────────┐
│  LEFT SIDEBAR │  MAIN / CENTER       │ RIGHT SIDEBAR │
│  (navigation) │  (detail / content)  │ (context)     │
│               │                      │               │
│  ▪ Projects   │  ● Selected item     │  ▲ Extra      │
│    • Proj A   │    - mission detail  │    detail     │
│      • misión │    - kanban board    │    (opened    │
│      • misión │    - runs/logs       │     on demand)│
│    • Proj B   │    - controls        │               │
│  ⚙ Settings   │                      │  e.g. task    │
│  ? Help       │                      │  detail/logs  │
└───────────────┴──────────────────────┴───────────────┘
```

- **Left sidebar**: project list → expandable to missions (navigable tree).
  Bottom: Settings + Help. **No "Add project" here** — creation is a FAB.
- **Center**: the selected project/mission detail, kanban, runs, logs, controls.
- **Right sidebar**: opens on demand for extra detail — a task's
  subtasks/dependencies/logs, an agent run's full log, etc.

### Primary actions are FABs (consistent placement)

All "create" actions are floating action buttons in the bottom-right, stacked
above the global Hermes chat FAB — never scattered across sidebar/header:

- **Add project** → FAB on the Office view.
- **New mission** → FAB on the project view.
- **New task** → FAB on the mission view.

The mission header only holds view toggle (kanban/list), edit, and delete. A
mission is a **container** — it has no start/pause/stop; each parent task is
run individually from the board.

### Responsive behavior

- **Desktop/tablet-landscape**: full 3-column layout.
- **Phone portrait**: columns collapse — the left sidebar becomes a slide-in
  drawer (bottom-left), the right sidebar becomes a bottom sheet or slide-in
  drawer. Center is the main screen. This keeps "see detail without losing
  context" on mobile as a drawer on top of the current view.

## Screens (within the 3-column shell)

- **Settings screen** (opened from left sidebar) — full-screen panel:
  - Subagent recipes (templates) — each has a single user-written title +
    description (not per-language) + system prompt + optional provider/model.
    These are the **executor** roles the orchestrator can assign subtasks to
    (reviewer, frontend, backend, security, …). The orchestrator itself is NOT a
    recipe — it is the Hermes driver configured per parent task in the mission
    board (see `02-data-model.md`).
  - App preferences (language EN/ES, theme dark/light).
  - Hermes tools viewer (skills + MCP servers).
- **Office / Projects view** — the main center view when nothing is selected:
  global summary of all projects + active/paused/failed missions (live via WS).
  Top row of stat tiles (projects, active, done, failed tasks), then a row of
  action cards. **GitHub Tasks** card (link to the `/tasks` PR page) and a
  **Resume** card + list shown when any task is `blocked` or has a failed run.
  FAB to add a project.
- **Project view** — repo details (path, git/folder type, branch) + its missions.
  FAB to add a mission.
- **Mission view** — a container (name + description). Its board holds parent
  (orchestrator) tasks, each with its own driver config + subagents + git
  strategy. FAB to add a task. Header: view toggle + edit + delete only.
  The kanban groups each **family** (an orchestrator task + all its subtasks)
  as a single unit that moves through the columns together — a parent and its
  subtasks never scatter across different columns. The family's column is
  derived from aggregate progress (blocked → doing → done), and each subtask
  shows a legend chip (✔ done / blocked / running / delegating / waiting) so
  you can still tell what each member is doing at a glance.
- **GitHub Tasks view (`/tasks`)** — PRs across every registered project. Search
  box + filter chips by state (All/Open/Draft/Merged/Closed) + project selector.
  Each row: state badge, title, `#number`, branch, repo, author, and last-updated
  age. Tapping a row opens its detail.
- **PR detail view (`/pr/:projectId/:number`)** — a single pull request: header
  with state badge (Open/Draft/Merged/Closed) + repo + `#number` + author, an
  actions row (Create **Worktree** on the PR's branch, Merge, Squash, Close,
  **Open in GitHub** in a new tab, **Copy GitHub link**), the PR body, and a
  Discussion/comments section with an inline composer to post a new top-level
  comment. Mutations confirm and show success/error feedback live.
  GitHubItemDialog pattern)

## Mobile UX principles

- **Thumb-friendly**: primary actions within reach; bottom nav on phone.
- **Realtime**: kanban and states animate live (WebSocket), no refresh.
- **Clear hierarchy**: left sidebar tree (Office → Project → Mission), with
  right sidebar for drill-in context. Max 3 levels of hierarchy.
- **Single-user**: no login (phase 1), protected by Tailscale.

## Key components

- `AppShell` — the 3-column responsive layout (left nav / center / right drawer).
- `SettingsScreen` — subagent recipes + app preferences (EN/ES, dark/light).
- `NewProject` — the folder combo+search (open/create/clone).
- `ProjectDetail` — the project's missions + branch.
- `NewMission` — name + description only (a container).
- `MissionKanban` — the mission's task board (own, in-project). Renders the task
  tree (subtasks + dependencies), each task's state, and links to its logs/agent
  runs. Each parent task can be run individually. The board groups tasks by
  **family** (orchestrator + subtasks) so the whole unit moves through the
  columns together; subtasks render as legend chips under their parent.
- `MissionLogs` — live event/log stream.
- `AgentRuns` — per-task & per-agent runs with history/logs (right sidebar).
- `TasksView` — GitHub Tasks list (`/tasks`): all projects' PRs + search/filters.
- `PrDetailView` — single PR detail (`/pr/:projectId/:number`): actions (worktree,
  merge, squash, close, open-in-GitHub, copy-link), body, comments + composer.
- `FilesTab` / `FileViewer` — project/mission file browser + viewer (overlay is
  portal-rendered to `document.body` so it always sits above the app topbar in
  mobile, where the workspace panel creates its own stacking context).

## Testing

- **Unit/component tests**: Vitest + jsdom (`npm test`).
- **E2E tests**: Playwright with **chromium headless** (`npm run test:e2e`).
  These run against the real dev servers (Vite :5175 + API :4310) and verify
  the app loads and that primary action buttons live in the right places
  (FABs, not scattered across sidebar/header).
