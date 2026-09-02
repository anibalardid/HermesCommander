# 00 — Vision & Scope

## What it is

Hermes Commander is a personal **mission control room**: a web daemon living on your
host plus a PWA to monitor and direct your "team" of AI agents
working on your projects.

**The user (startup founder or solopreneur) sees everything from their phone**: the global state of
all projects (the "office"), active missions, the kanban boards, and can
intervene live (pause, redirect, message the agent).

## Guiding principles

1. **Hermes orchestrates, the rest execute.** We don't reinvent orchestration;
   Hermes Commander spawns Hermes per mission with a specific profile/model/provider/
   worktree.
2. **Single-user, 100% web.** Access over Tailscale. The host runs
   the processes; the phone is just the window.
3. **Polymorphic mission.** Each mission is configured at creation: git strategy
   (worktree/branch/none), kanban on/off, driver agent, objective, intervention.
4. **Reuse before building.** Everything Hermes kanban and git already do
   well is adopted, not duplicated. But the kanban board itself is **built 100%
   in this project** — nothing is embedded from elsewhere.
5. **Multi-language UI.** English and Spanish UI strings (i18n). Code and
   documentation are always in English.

## What it is NOT (scope boundaries)

- Not multi-user (later phase).
- Does not run agents in the cloud; runs on the local host (or VPS as fallback).
- Does not replace the editor or Hermes CLI; it is the direction/observation layer.

## Usage profiles

- Create a **project** (open local folder / create new / clone repo).
- Within a project, launch **missions** (each = objective + agent + isolated
  work strategy).
- See each mission's **kanban** and the **global office state**.
- **Intervene live**: pause, redirect, message the agent.

## Decisions already made

- Name: **Hermes Commander** (dir slug `hermes-commander`). Code/docs in English, UI in EN+ES.
- Stack: Node/TS monorepo. Backend Fastify + WS + SQLite. Frontend React PWA
  with a shadcn-style component kit (dark/light mode).
- Hermes is always the orchestrator; Codex/OpenCode/Claude are executors.
- Profile, provider and model selectable **per mission** (`hermes chat` flags).
- Multiple missions in parallel, **cap of 5 per project**.
- An orchestrator may depend on other missions/projects.
- Single-user.
- Kanban board **built in-project** (not embedded from Hermes).
- **Full project build** — no MVP phases; everything is implemented.
- **Detailed telemetry**: logs + per-task & per-agent history.
