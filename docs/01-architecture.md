# 01 — Arquitectura

## Vista de alto nivel

```
                          TELCEL / TABLET / ESCRITORIO
                          (PWA React, vía Tailscale)
                                     │  HTTPS
                                     │  REST + WebSocket (eventos en vivo)
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│                       BACKEND DAEMON (Node/Fastify)          │
│  Vive en tu host (Mac mini / miniPC / MacBook / Linux)        │
│                                                              │
│  ┌────────────┐ ┌──────────────┐ ┌────────────────────────┐  │
│  │  API REST  │ │  Realtime    │ │   Mission Runner       │  │
│  │  (CRUD)    │ │  hub (WS)    │ │   spawna hermes        │  │
│  └────────────┘ └──────────────┘ └───────────┬────────────┘  │
│  ┌────────────┐ ┌──────────────┐             │               │
│  │ SQLite     │ │ Worktree     │             │ spawn         │
│  │ (better-   │ │ Manager      │             ▼               │
│  │  sqlite3)  │ │ (git)        │   hermes -p <profile> -m     │
│  └────────────┘ └──────────────┘   <model> --provider <prov>  │
│                                    -w <worktree> chat -q ...   │
└─────────────────────────────────────────────────────────────┘
                                     │
                                     └──► delegate_task ──► subagentes
                                          (prompts de sistema + LLMs propios)
```

## Componentes

### 1. API REST (Fastify)
CRUD de proyectos, misiones, tareas. Crear proyecto (abrir/clonar/crear),
crear misión, control de misión (start/pause/resume/stop/interrupt).

### 2. Realtime Hub (WebSocket)
Empuja eventos en vivo al frontend: estado de misión, tareas nuevas,
movimientos de kanban, logs del agente, subagentes activos. El frontend se
suscribe y la "oficina" se anima sola.

### 3. Mission Runner
El corazón. Por cada misión activa, spawna un proceso `hermes` con los flags
elegidos en la misión. Gestiona el ciclo de vida del subproceso (start, pause,
interrupt via stdin/tmux, kill). Escucha stdout/stderr y los convierte en
eventos/tareas.

### 4. Worktree Manager
Envuelve `git worktree add/remove`. Por cada misión con estrategia "worktree",
crea una copia aislada del repo con su propia rama. Reutiliza el patrón de worktrees:
base ref + branch + directorio + agente.

### 5. Persistencia (SQLite)
`better-sqlite3`. Tablas: `proyectos`, `misiones`, `tareas`, `events`,
`agents_config`. Almacena todo el estado para que Hermes Commander sobreviva
reinicios del daemon.

## Flujo de creación de misión

1. Usuario abre un **proyecto** (carpeta existente / nueva / clonar).
2. Elige **config de misión**: nombre, objetivo, estrategia de git
   (worktree/branch/ninguno), ¿kanban?, agente driver (perfil/model/provider),
   nivel de intervención.
3. Backend **crea el worktree** (si aplica) y **spawna Hermes** con los flags.
4. Hermes planea, delega a subagentes, reporta tareas al kanban.
5. El Realtime Hub refleja todo en el celular.
6. El usuario puede **intervenir** en vivo.

## Concurrencia

Múltiples misiones en paralelo. Cada misión = 1 subproceso
`hermes` aislado + su worktree propio. Un Mission Runner con cola/worker pool
gestiona la concurrencia y evita conflictos de git.

## Consideración de ejecución (host vs VPS)

- **Default**: host local (Mac/miniPC/linux). Todo integrado con tools locales
  (Ollama, keychains, worktrees locales).
- **Futuro / fallback**: VPS DO Ubuntu como replicación o ejecución alternativa.
  La separación backend/frontend lo hace portable.
