# Deploying Hermes Commander as a daemon

Hermes Commander runs as a background daemon on your host (Mac/miniPC/Linux) so it's
available 24/7 over Tailscale. This directory contains the packaging.

## Quick start (any OS)

```bash
./hermes-commander.sh start    # start in background
./hermes-commander.sh status   # check status
./hermes-commander.sh logs     # tail the log
./hermes-commander.sh stop     # stop
```

The script uses the compiled build (`apps/server/dist`) if present, otherwise
falls back to `tsx`. Set `HERMES_COMMANDER_DB`, `PORT`, `HOST` via env to override.

### Embedded-terminal prerequisites (TUI tab)

The `Terminal` tab needs `python3` + the `hermes` CLI on the host's PATH. Verify
and (optionally) install them with:

```bash
./deploy/setup-terminal.sh         # check + report
./deploy/setup-terminal.sh --fix   # attempt to install missing pieces
```

See `docs/09-tui-terminal.md` for details.

## macOS — auto-start at login (launchd)

1. Build the server once: `cd apps/server && npm run build`
2. Install the plist:
   ```bash
   cp deploy/com.anibal.hermes-commander.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.anibal.hermes-commander.plist
   ```
3. It starts at login and restarts if it crashes (`KeepAlive`).

## Linux — systemd

1. Build the server once: `cd apps/server && npm run build`
2. Install the unit (adjust `User`/paths in the file first):
   ```bash
   sudo cp deploy/hermes-commander.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now hermes-commander
   ```

## Notes

- The daemon binds `0.0.0.0:4310` by default. Access it from your phone/tablet
  via the Tailscale IP (e.g. `http://100.96.71.26:4310`).
- The frontend (Vite) is a separate process for development; for production you
  would serve the built `apps/web/dist` behind a static server or the daemon.
- Missions that were `running` when the daemon restarts auto-resume (see
  `docs/03-mission-runtime.md`).
