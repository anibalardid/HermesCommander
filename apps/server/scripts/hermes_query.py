#!/usr/bin/env python3
"""Query Hermes Agent for profiles, providers, and models.

Hermes Commander's mission form needs to list the Hermes profiles (the orchestrator
is always Hermes), the available providers, and the models per provider. This
script shells out to the Hermes Python environment and prints a JSON document
the Node backend can consume.

Usage:
    hermes_query.py profiles
    hermes_query.py providers
    hermes_query.py models <provider>
"""
import json
import os
import sys

HERMES_HOME = os.path.expanduser("~/.hermes/hermes-agent")


def _setup():
    sys.path.insert(0, HERMES_HOME)


def profiles():
    _setup()
    from hermes_cli.profiles import list_profiles
    out = []
    for p in list_profiles():
        out.append({
            "name": getattr(p, "name", ""),
            "model": getattr(p, "model", ""),
            "provider": getattr(p, "provider", ""),
        })
    return out


def providers():
    _setup()
    from hermes_cli.models import CANONICAL_PROVIDERS
    return [p.slug for p in CANONICAL_PROVIDERS]


def models(provider):
    _setup()
    from hermes_cli.models import provider_model_ids
    try:
        return provider_model_ids(provider)
    except Exception:
        return []


def sessions(profile=None, source=None, limit=20):
    """List recent interactive sessions for a profile (or default). Used by the
    floating chat to let the user resume a previous conversation of the selected
    profile. Reads the profile's own state.db by resolving its home."""
    _setup()
    import os as _os
    from pathlib import Path as _Path
    # Resolve the profile home. 'default' -> ~/.hermes; otherwise profiles/<name>.
    base = _Path(_os.environ.get("HERMES_HOME", "") or _os.path.expanduser("~/.hermes"))
    if profile and profile != "default":
        home = base / "profiles" / profile
    else:
        home = base
    state_db = home / "state.db"
    if not state_db.exists():
        return []
    # Open the profile's own state.db directly (explicit path — the env var
    # alone isn't reliable because hermes_state snapshots its home at import).
    from hermes_state import SessionDB
    db = SessionDB(db_path=_Path(state_db))
    rows = db.list_sessions_rich(
        source=source, limit=limit, order_by_last_active=True, compact_rows=True
    )
    out = []
    for r in rows:
        out.append({
            "id": r.get("id"),
            "source": r.get("source"),
            "title": r.get("title") or "",
            "preview": r.get("preview") or "",
            "model": r.get("model") or "",
            "last_active": r.get("last_active"),
        })
    return out


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "profiles":
        print(json.dumps(profiles()))
    elif cmd == "providers":
        print(json.dumps(providers()))
    elif cmd == "models" and len(sys.argv) > 2:
        print(json.dumps(models(sys.argv[2])))
    elif cmd == "sessions":
        profile = None
        source = None
        limit = 20
        args = sys.argv[2:]
        i = 0
        while i < len(args):
            if args[i] == "--profile" and i + 1 < len(args):
                profile = args[i + 1]; i += 2
            elif args[i] == "--source" and i + 1 < len(args):
                source = args[i + 1]; i += 2
            elif args[i] == "--limit" and i + 1 < len(args):
                limit = int(args[i + 1]); i += 2
            else:
                i += 1
        print(json.dumps(sessions(profile=profile, source=source, limit=limit)))
    else:
        print(json.dumps({"error": "usage: hermes_query.py profiles|providers|models <provider>|sessions [--profile NAME] [--source S] [--limit N]"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
