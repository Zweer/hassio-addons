"""Apply Home Assistant add-on options to the Kiro Crew config.

Reads /data/options.json once, merges the keys the add-on manages into
~/.kiro/crew/config.json (atomic replace, every other key is preserved) and
prints shell-quoted `export` lines for the secrets on stdout. run.sh evals
that output, and the upstream entrypoint later moves each secret into the
chmod-600 .env file and removes it from the environment.

Only real Kiro Crew config keys are written. Keys that earlier add-on
versions invented are removed so they stop looking like they do something.
"""

from __future__ import annotations

import json
import os
import shlex
import sys
import urllib.request
from pathlib import Path

OPTIONS_PATH = Path("/data/options.json")
CONFIG_PATH = Path(os.environ.get("HOME", "/data/home")) / ".kiro" / "crew" / "config.json"

# (section, key) pairs written by add-on versions <= 0.2.x that Kiro Crew
# never read.
STALE_KEYS = [
    ("knowledge", "embed_content_budget"),
    ("session", "warm_pool_size"),
    ("dashboard", "open_browser"),
]

# option name -> environment variable the upstream entrypoint stores in .env
SECRET_OPTIONS = {
    "kiro_api_key": "KIRO_API_KEY",
    "telegram_bot_token": "TELEGRAM_BOT_TOKEN",
    "discord_bot_token": "DISCORD_BOT_TOKEN",
    "slack_bot_token": "SLACK_BOT_TOKEN",
    "slack_app_token": "SLACK_APP_TOKEN",
    "slack_owner_id": "KIROCREW_OWNER_ID",
}


def apply(cfg: dict, opts: dict, ha_external_url: str = "") -> dict:
    """Return cfg with the add-on managed keys set from opts."""
    for section, key in STALE_KEYS:
        cfg.get(section, {}).pop(key, None)

    agent = cfg.setdefault("agent", {})
    # "off" bypasses the exec guard entirely; "auto" uses a sandbox backend
    # when the runtime allows one and otherwise falls back to the explicit
    # opt-in below (HA's AppArmor profile usually blocks user namespaces).
    if agent.get("sandbox", "off") == "off":
        agent["sandbox"] = "auto"
    agent.setdefault("sandbox_allow_unsandboxed_exec", True)
    agent["log_level"] = str(opts.get("log_level", "info")).upper()

    session = cfg.setdefault("session", {})
    # pool_size is a warm pool of pre-started kiro-cli processes, not a
    # concurrency limit; on a 4 GB host every idle process is wasted RAM.
    session["pool_size"] = 0
    session["timeout_secs"] = int(opts.get("session_timeout_secs", 900))
    session["watchdog_rss_max_mb"] = int(opts.get("watchdog_rss_max_mb", 1536))

    memory = cfg.setdefault("memory", {})
    memory["embedding_idle_evict_secs"] = int(opts.get("embedding_idle_evict_secs", 300))
    memory["embedding_weight_repack"] = bool(opts.get("embedding_weight_repack", False))

    cfg.setdefault("telemetry", {})["beacon_enabled"] = bool(opts.get("telemetry", False))

    dashboard = cfg.setdefault("dashboard", {})
    url = opts.get("external_url") or ha_external_url
    if url:
        dashboard["url"] = url

    if opts.get("telegram_bot_token"):
        cfg["telegram"] = {
            **cfg.get("telegram", {}),
            "enabled": True,
            "allowed_user_ids": [int(i) for i in opts.get("telegram_allowed_user_ids", [])],
        }
    if opts.get("discord_bot_token"):
        cfg["discord"] = {
            **cfg.get("discord", {}),
            "enabled": True,
            "allowed_user_ids": [str(i) for i in opts.get("discord_allowed_user_ids", [])],
        }
    return cfg


def secret_exports(opts: dict) -> list[str]:
    return [
        f"export {env}={shlex.quote(str(opts[name]))}"
        for name, env in SECRET_OPTIONS.items()
        if opts.get(name)
    ]


def ha_external_url() -> str:
    """Home Assistant's own external_url (needs homeassistant_api: true)."""
    token = os.environ.get("SUPERVISOR_TOKEN")
    if not token:
        return ""
    req = urllib.request.Request(
        "http://supervisor/core/api/config",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.load(resp).get("external_url") or ""
    except (OSError, ValueError):
        return ""


def write_atomic(path: Path, data: dict) -> None:
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    os.replace(tmp, path)


def main() -> int:
    opts = json.loads(OPTIONS_PATH.read_text()) if OPTIONS_PATH.exists() else {}
    try:
        cfg = json.loads(CONFIG_PATH.read_text())
    except FileNotFoundError:
        cfg = {}
    except ValueError:
        # Never overwrite a config.json we cannot parse: that would drop
        # every setting the user made in the dashboard.
        print(f"[kirocrew-addon] ERROR: {CONFIG_PATH} is not valid JSON", file=sys.stderr)
        return 1
    url = "" if opts.get("external_url") else ha_external_url()
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_atomic(CONFIG_PATH, apply(cfg, opts, url))
    print("\n".join(secret_exports(opts)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
