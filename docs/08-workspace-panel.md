# 08 — Workspace panel (Logs / Source control / Files)

El panel lateral de una misión, abierto desde el botón del topbar (a la derecha de
Eliminar). Contiene 3 tabs: **Logs**, **Source control** y **Files**.

## Comportamiento responsive

| Pantalla    | Ancho          | Comportamiento                                            |
|-------------|----------------|-----------------------------------------------------------|
| Desktop lg+ | ~25% (px)      | Columna fija al lado del kanban; empuja el contenido.     |
| Tablet md   | px (50% aprox) | Columna fija con resize (mismo comportamiento que desktop).|
| Mobile      | 100%           | Drawer overlay a pantalla completa (no empuja el kanban). |

- **Resize**: en desktop/tablet hay un "gutter" en el borde izquierdo del panel
  para arrastrar y redimensionar (min 260px, max 560px).
- **Persistencia**: el ancho se guarda en `localStorage` (`hermes-commander.workspace.width`)
  y se restaura al reabrir. Es global (no por misión).
- **Ocultar**: botón `X` en el header del panel + toggle del botón del topbar.
- El tab del panel se conserva mientras la misión esté abierta.

## Tabs

### Logs
Idéntico al panel de logs anterior (búsqueda + filtro por nivel), extraído a
`apps/web/src/components/workspace/LogsTab.tsx`.

### Source control
- Muestra la rama actual, el directorio de trabajo, los archivos con cambios
  (M/A/D/??), y el estado ahead/behind.
- Click en un archivo → abre su **diff**.
- Acciones: **Commit** (mensaje + `git add -A` + commit) y **Push**.
- **Create PR** se hace con el GitHub CLI (`gh`) y queda documentado abajo.
- PRs abiertos se listan bajo la sección "Pull requests" si `gh` está disponible.

#### Resolución del directorio de trabajo (task scope)

Cuando el panel se abre sobre una **task**, el directorio de trabajo se resuelve
así (el worktree de la task puede haber sido borrado tras mergear su PR):

```
                    ┌──────────────────────────────┐
                    │  GET /api/tasks/:id/source     │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │  task.worktree_path set?     │
                    └───┬──────────────────────┬────┘
                        │                    │
                      YES                    NO
                        │                    │
                        ▼                    │
              ┌──────────────────┐           │
              │  worktree exists │           │
              │  on disk?        │           │
              └───┬──────────┬───┘           │
                  │          │               │
                YES          NO              │
                  │          │               │
                  ▼          ▼               │
        ┌──────────────┐  ┌──────────────────┴──────┐
        │  use worktree│  │  fall back to mission/  │
        │  path        │  │  project workdir        │
        └──────────────┘  └─────────────────────────┘
```

Si el worktree fue borrado, el endpoint **degrada al workdir de la misión**
(repo principal) en vez de devolver 500 — el UI sigue pudiendo renderizar el
modal de Create PR y el tab source.

### Files
- File browser del directorio de trabajo de la misión (worktree si existe, si no
  el path del proyecto). Breadcrumb en la parte superior.
- **Seguridad**: no se puede navegar más allá del root del proyecto — el backend
  resuelve el path y rechaza (403) cualquier intento de escapar el directorio.
- Carpetas primero (alfabético), luego archivos (alfabético). Se ignoran
  `.git`, `node_modules`, `dist`, `.next`, `coverage`, `.cache` y archivos ocultos.
- Click en un archivo → viewer de texto (máx 200KB; binarios/largos se rechazan).

## GitHub CLI (`gh`) — fuente de verdad para PRs

**Requisito**: el GitHub CLI (`gh`) debe estar instalado y autenticado en el host
para crear y listar PRs. Commit y push funcionan siempre con `git` puro (no
dependen de `gh`).

- Instalar: `brew install gh` (macOS) / `sudo apt install gh` (Debian/Ubuntu).
- Autenticar: `gh auth login`.

Cuando `gh` no está disponible:
- La sección "Pull requests" no se lista.
- El botón de crear PR no está habilitado.
- Se muestra un aviso: "GitHub CLI (gh) no instalado — creación de PR deshabilitada."

## Instalador

El plan es agrupar las dependencias del host en un **script instalador** que
verifique/instale: `git`, `gh` (opcional pero recomendado), `node`/`npm`, y las
herramientas que Hermes Commander ya usa. El instalador debe:
1. Verificar `git --version` y `gh --version` y avisar cuáles faltan.
2. No fallar si `gh` falta (commit/push siguen funcionando) — solo lo marca como
   opcional para PRs.
3. Avisar el estado de cada dependencia al final.

## Endpoints

Ver `05-api.md` — sección "Workspace panel". Backend: `apps/server/src/git/status.ts`
(git + gh) y `apps/server/src/git/files.ts` (file browser con validación de root).
