# Scripts de Hermes Commander

Guía de los scripts de shell que viven en la raíz del repo (`start.sh`,
`stop.sh`, `install.sh`, `reset-db.sh`, `test.sh`). Todos son bash puro, sin
dependencias externas, y comparten helpers en `lib/common.sh`.

## Índice

- [Resumen](#resumen)
- [Requisitos previos](#requisitos-previos)
- [Detección multiplataforma (macOS / Linux)](#detección-multiplataforma-macos--linux)
- [install.sh](#installsh)
- [start.sh](#startsh)
- [stop.sh](#stopsh)
- [reset-db.sh](#reset-dbsh)
- [test.sh](#testsh)
- [Flujo de confirmaciones](#flujo-de-confirmaciones)
- [Solución de problemas](#solución-de-problemas)
- [Cómo contribuir / extender](#cómo-contribuir--extender)

## Resumen

| Script | Qué hace | Cuándo usarlo |
|--------|----------|---------------|
| `install.sh` | Valida e instala los requisitos del host (node, git, hermes, etc.) | Al preparar una máquina nueva |
| `start.sh` | Arranca los servicios (API + frontend) en orden | Para levantar el entorno de desarrollo |
| `stop.sh` | Detiene los servicios en ejecución | Para apagar el entorno |
| `reset-db.sh` | Borra la base de datos y la re-inicializa desde cero | Para volver a cero la DB |
| `test.sh` | Configura una base de datos de prueba y corre la suite | Antes de commitear / en CI |

## Requisitos previos

Los scripts asumen **bash** (3.2+ en macOS, 4+ en Linux) y no requieren nada
más para ejecutarse: `lib/common.sh` es bash puro y no usa herramientas
externas salvo las que detecta en tiempo de ejecución (`pgrep`, `lsof`, `ss`,
`netstat`, `fuser`).

Los requisitos del *proyecto* (no de los scripts) los valida `install.sh`:

| Requisito | Tipo | Nota |
|-----------|------|------|
| `node` (>=20) | requerido | `engines.node` en `package.json` |
| `npm` | requerido | viene con node (instalación manual) |
| `python3` | requerido | helper PTY del terminal embebido |
| `git` | requerido | worktrees, clone, source control |
| `gh` | opcional | solo para crear PRs |
| `hermes` | requerido | orquestador + terminal TUI (instalación manual) |
| `tailscale` | opcional | acceso remoto desde el móvil |

> `docker` **no** es dependencia: no hay `Dockerfile` ni `docker-compose` en el
> repo. La base de datos es SQLite embebida en la API.

## Detección multiplataforma (macOS / Linux)

`lib/common.sh` expone `detect_os`, que devuelve `macos` o `linux` según
`uname -s` (cualquier otro valor devuelve `unknown` y falla). Sobre eso se
construyen dos capas de adaptación:

1. **Gestor de paquetes** (`pkg_manager`): elige el primero disponible.
   - macOS → `brew`
   - Linux → `apt-get` (Debian/Ubuntu), `dnf` (Fedora/RHEL), `yum` (RHEL/CentOS
     viejo), `apk` (Alpine)

2. **Comandos específicos de SO**:
   - `sed_i` — edición in-place que funciona en ambos (macOS `sed -i` exige un
     sufijo de backup; GNU sed no).
   - Detección de puertos/procesos: `start.sh` y `stop.sh` usan `lsof` en macOS
     y `ss`/`netstat`/`fuser` en Linux.

Si no hay ningún gestor de paquetes soportado, `install.sh` lo reporta con un
error claro y sugiere instalar uno (p. ej. Homebrew en macOS).

## install.sh

Valida los requisitos del host y ofrece instalarlos **de a uno**, nunca en
lote.

```
./install.sh            # chequea, reporta y ofrece instalar lo que falta
./install.sh --dry-run  # igual, pero solo IMPRIME los comandos (no ejecuta)
```

Flujo:

1. **Pass 1 — chequeo**: recorre la tabla de requisitos y reporta cada uno como
   instalado (con versión) o faltante (requerido/opcional).
2. **Pass 2 — instalación**: por cada faltante, pide confirmación individual.
   - Requisitos con paquete → muestra el comando exacto y pregunta
     `Install <name>?`.
   - Requisitos "manuales" (`npm`, `hermes`, `tailscale`) → no hay comando de
     gestor; muestra la nota y pregunta si marcarlo como manejado manualmente.
3. **Pass 3 — resumen final**: re-chequea qué quedó instalado y qué sigue
   faltando. Sale con `0` si todo está satisfecho, `1` si algo requerido sigue
   faltando.

## start.sh

Arranca los servicios en orden: base de datos → API → frontend.

```
./start.sh
```

Antes de arrancar:

- **Valida Hermes**: si el gateway no está corriendo (proceso `gateway run` o
  puerto `:8642`), avisa que las misiones no podrán spawnear agentes y sugiere
  `hermes gateway start`. No bloquea el arranque.
- **Detecta servicios de este repo ya corriendo** y, si los hay, pide **una
  sola** confirmación para detenerlos y reiniciarlos (ver
  [flujo de confirmaciones](#flujo-de-confirmaciones)). Si no hay nada que
  detener, no pregunta.

Detección acotada al repo: un servicio se considera "de este repo" si su PID
está registrado en un PID file bajo `data/` (escrito por `start.sh`) y sigue
vivo, **o** si el proceso que escucha en el puerto tiene su cwd bajo la raíz
del repo. Nunca se detiene un proceso que no se pueda probar que pertenece a
este repo (p. ej. otro checkout de hermes-commander, u opencode escuchando en 5173).

Idempotencia: arrancar un servicio que ya está corriendo (de este repo) no da
error ni duplica — se omite y se informa.

Servicios:

| Servicio | Cómo arranca | Puerto | Log / PID |
|----------|--------------|--------|-----------|
| Base de datos | SQLite embebida — no es un proceso aparte; la API la crea/migra | — | — |
| API (Fastify) | `npm run dev:server` | `4310` | `data/api.log` / `data/api.pid` |
| Frontend (Vite) | `npm run dev:web` | `5173` | `data/web.log` / `data/web.pid` |

Variables de entorno (sobrescribibles):

- `HERMES_COMMANDER_DB` — ruta de la base (default `apps/server/data/hermes-commander.db`)
- `PORT` — puerto de la API (default `4310`)
- `WEB_PORT` — puerto del frontend (default `5173`)

> **Ruta de la base de datos**: la API corre con cwd `apps/server` y resuelve
> `data/hermes-commander.db` relativo a ese cwd, así que la base real vive en
> `apps/server/data/hermes-commander.db` (NO en `data/hermes-commander.db` de la raíz). Los
> scripts `start.sh` y `reset-db.sh` ya apuntan a la ruta correcta.

Al final verifica que API y frontend estén corriendo y sale con `0` o `1`.

## stop.sh

Detiene los servicios en ejecución. **Solo detiene** (nunca arranca) y **no
toca Hermes**: únicamente API, base de datos y frontend.

```
./stop.sh          # detecta y pide confirmación por cada servicio
./stop.sh -y       # detiene todo sin pedir confirmación (no interactivo)
./stop.sh --help   # ayuda
```

Mecánica de detención: `SIGTERM`, espera `GRACE_SECS` (default 5 s) y, si el
proceso sigue vivo, `SIGKILL`. La base de datos se detiene según su mecanismo:
`docker` (si hay `docker-compose.yml`) o `embedded` (SQLite, se detiene junto
con la API). Si no hay nada corriendo, imprime "No hay servicios en ejecución"
y sale con `0` **sin pedir confirmación**.

Detección acotada al repo: igual que `start.sh` — solo se detienen procesos
que se pueda probar que pertenecen a este repo (PID file vivo bajo `data/`, o
proceso escuchando en el puerto con cwd bajo la raíz del repo). Nunca se
detiene un proceso de otro proyecto que comparta puerto o patrón de comando.
Confirmación única: si hay algo que detener, se pide **una sola** confirmación
para todo (o ninguna con `-y`).

### Detención manual (si `stop.sh` no alcanza)

`stop.sh` solo detiene procesos que se pueda **probar** que pertenecen a este
repo. Si un servicio quedó colgado, o querés detenerlo a mano, los PID files
están en `data/` y los puertos son `4310` (API) y `5173` (frontend):

```bash
# Detener por PID file (si el proceso sigue vivo)
kill "$(cat data/api.pid)" 2>/dev/null
kill "$(cat data/web.pid)" 2>/dev/null

# O por puerto (macOS)
lsof -ti tcp:4310 -sTCP:LISTEN | xargs kill
lsof -ti tcp:5173 -sTCP:LISTEN | xargs kill

# O por puerto (Linux)
fuser -k 4310/tcp 5173/tcp
```

> La base de datos es SQLite embebida: no hay proceso aparte que detener; se
> cierra junto con la API. Si un PID file quedó huérfano (proceso ya muerto),
> `stop.sh` lo ignora y `start.sh` lo sobrescribe al arrancar — no hace falta
> borrarlo a mano.

## reset-db.sh

Borra la base de datos y la re-inicializa desde cero. La DB es SQLite embebida
en la API: el `Store` la crea/migra/siembra automáticamente al arrancar, así
que "resetear" significa detener la API, borrar el archivo de la DB (y sus
sidecars WAL/SHM) y arrancar la API de nuevo para que la recree.

```bash
./reset-db.sh          # interactivo (dos confirmaciones)
./reset-db.sh --help   # ayuda
```

**Doble confirmación** (acción destructiva e irreversible):

1. Un prompt estándar sí/no.
2. Si se confirma, hay que **escribir la fecha del día** (`YYYY-MM-DD`) para
   proceder.

Flujo:

1. Detiene la API (si está corriendo) para que el archivo no quede bloqueado.
2. Borra `$DB_PATH` (default `apps/server/data/hermes-commander.db`) y sus sidecars
   `-wal` / `-shm`.
3. Arranca la API de nuevo — el `Store` recrea el schema, corre las
   migraciones y siembra los agentes/recetas por defecto en el primer arranque.
4. Verifica que la DB se haya recreado.

> **Advertencia**: se pierden **todos** los proyectos, misiones, tareas, runs y
> logs. No hay vuelta atrás.

## test.sh

Configura una base de datos de prueba **dedicada** en un **path throwaway**
(un directorio temporal creado con `mktemp -d`, nunca la de producción
`apps/server/data/hermes-commander.db`) y corre la suite. El directorio temporal se
elimina al terminar — tanto en éxito como en fallo o interrupción (trap) — de
modo que no queda estado residual en ningún camino de salida.

```
./test.sh
```

Flujo:

1. Si no existe `node_modules`, ofrece `npm install`.
2. Configura la DB de prueba (con confirmación en cada paso): migraciones
   (`lib/db.mts migrate`), seed (`apps/server/src/seed.ts`) y validación
   (`lib/db.mts validate`).
3. Detecta el test runner (en orden: script `test` de `package.json` → vitest →
   jest → pytest) y corre los tests con confirmación.

`lib/db.mts` se niega a correr contra la base de producción
(`apps/server/data/hermes-commander.db`) y reporta errores con salida no-cero y
mensaje claro.

## Flujo de confirmaciones

Todos los pasos con efecto piden confirmación explícita. El helper
`ask_confirm` (en `common.sh`) lee una línea de stdin, acepta `y`/`yes`/`si`/`s`
(case-insensitive) y trata cualquier otra cosa —incluido EOF— como "no"
(default seguro).

| Script | Acción que pide confirmación | Por qué |
|--------|------------------------------|---------|
| `install.sh` | Instalar cada requisito faltante (uno por uno) | Evita instalar paquetes en lote sin consentimiento |
| `install.sh` | Marcar requisitos manuales como "manejados" | No hay comando de gestor; es un registro, no una acción |
| `start.sh` | Detener y reiniciar API/frontend ya corriendo (una sola confirmación) | No interrumpir un proceso que quizá estás usando |
| `stop.sh` | Detener los servicios (una sola confirmación, salvo con `-y`) | Detener procesos es destructivo; `-y` para no-interactivo |
| `reset-db.sh` | Confirmación sí/no + escribir la fecha del día | Borrar la DB es destructivo e irreversible; la fecha evita accidentes |
| `test.sh` | `npm install`, configurar DB, migraciones, seed, correr tests | Cada paso toca estado (deps, DB) o tarda |

> **Idempotencia de confirmación**: `start.sh` y `stop.sh` piden **una sola**
> confirmación antes de cualquier acción destructiva, y **no preguntan** si no
> hay nada que detener. Correrlos repetidamente es seguro: arrancar un servicio
> ya corriendo (de este repo) se omite sin error ni duplicado.

## Solución de problemas

### El puerto ya está en uso (API 4310 / frontend 5173)

`start.sh` solo detiene procesos que se pueda probar que pertenecen a este repo.
Si el puerto lo ocupa **otro** proceso (otro checkout, opencode, etc.), el
arranque falla con "La API no arrancó" / "El frontend no arrancó". Revisá quién
lo ocupa y decidí si conviene detenerlo:

```bash
# macOS
lsof -nP -iTCP:4310 -sTCP:LISTEN
# Linux
ss -ltnp | grep ':4310'
```

Si es un proceso de otro proyecto, no lo mates con `stop.sh` (no lo toca por
diseño): detenelo a mano o cambiá el puerto con `PORT` / `WEB_PORT`.

### PID file obsoleto (stale)

Un PID file en `data/` puede quedar apuntando a un proceso ya muerto (p. ej.
después de un crash o un `kill` manual). No es un problema: `pid_file_pid`
verifica que el proceso siga vivo y descarta el PID si no lo está, y `start.sh`
sobrescribe el archivo al arrancar. No hace falta borrarlo a mano.

### Hermes no está corriendo

`start.sh` avisa (sin bloquear) si el gateway de Hermes no está activo, porque
las misiones no podrán spawnear agentes. Arrancalo con:

```bash
hermes gateway start
```

La detección mira el proceso `gateway run` o el puerto `:8642`. Si Hermes está
corriendo pero el aviso persiste, verificá que el gateway escuche en `8642`.

### Los servicios no arrancan

Los logs están en `data/` (`api.log`, `web.log`). Si un servicio falla,
`start.sh` sale con código `1` y apunta al log correspondiente:

```bash
tail -n 50 data/api.log
tail -n 50 data/web.log
```

## Cómo contribuir / extender

Los helpers compartidos viven en **`lib/common.sh`**, que se *sourcea* (no se
ejecuta) desde cada script:

```bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT/lib/common.sh"
```

Helpers disponibles:

| Helper | Qué hace |
|--------|----------|
| `detect_os` / `is_macos` / `is_linux` | Detección de SO |
| `ask_confirm <msg>` | Prompt sí/no (default no) |
| `is_installed <cmd>` | ¿El binario está en el PATH? |
| `get_version <cmd>` | Versión best-effort (primera línea) |
| `is_running <patrón>` | ¿Hay un proceso que matchee? (`pgrep -f`) |
| `pid_cwd <pid>` | CWD de un proceso (lsof o `/proc/<pid>/cwd`) |
| `pid_cmdline <pid>` | Línea de comando completa de un proceso |
| `pid_alive <pid>` | ¿El proceso está vivo? |
| `pids_on_port <puerto>` | PIDs escuchando en un puerto TCP |
| `pid_belongs_to_repo <pid> <root>` | ¿El proceso pertenece a un repo (cwd o cmdline bajo root)? |
| `pids_on_port_for_repo <puerto> <root>` | PIDs en el puerto que pertenecen al repo |
| `pid_file_pid <pidfile>` | PID vivo de un pidfile (o nada) |
| `dedupe_pids <lista>` | PIDs únicos y válidos |
| `stop_pid <pid> <grace>` | SIGTERM → espera → SIGKILL |
| `print_status` / `print_ok` / `print_warn` / `print_error` | Salida con color (sin color si no es TTY) |
| `sed_i <expr> <file>` | Edición in-place multiplataforma |
| `pkg_manager` / `pkg_install` | Gestor de paquetes detectado |

Reglas para agregar helpers:

- **Bash puro**, sin dependencias externas.
- **Compatible con bash 3.2** (default de macOS): sin arrays asociativos ni
  features de bash 4+.
- **No fuerces `set -euo pipefail`** en `common.sh`: es un archivo sourceado y
  forzarlo rompería los prompts interactivos (`ask_confirm`) y a los callers que
  manejan su propio control de errores. Cada script lo activa por su cuenta.
- Los helpers locales de un script (p. ej. `port_in_use`, `stop_on_port` en
  `start.sh`) se definen en el propio script, no en `common.sh`, para no
  acoplarlo a un caso de uso puntual.

Hay un smoke test de `common.sh` en `lib/smoke_test.sh` que verifica los
helpers básicos; corrélo tras tocar `common.sh`:

```bash
bash lib/smoke_test.sh
```
