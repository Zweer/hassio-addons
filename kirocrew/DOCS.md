# Kiro Crew — Home Assistant Addon

A persistent AI development workspace that self-improves and continues
beyond one session.

## What it does

Kiro Crew runs as an always-on gateway on your Home Assistant hardware.
It orchestrates AI agents for long-running tasks, scheduled jobs, and
multi-session work — all accessible from the HA sidebar via ingress.

## Features

- **Ingress integration**: Access the Kiro Crew dashboard directly from
  Home Assistant's sidebar. No extra ports needed.
- **Persistent sessions**: Conversations and task state survive restarts.
- **Self-learning**: Corrections become durable lessons; repeated patterns
  become reusable skills.
- **Scheduled work**: Cron jobs, webhooks, and heartbeats run unattended.
- **Multi-surface**: Also accessible via Discord, Telegram, or Slack
  (configured inside Kiro Crew).

## First-run setup

1. Install the addon and start it.
2. Wait for the gateway to start (first boot may take 1-2 minutes).
3. **Login to Kiro CLI** — this is required before agents can work.
   From the SSH/Terminal addon, run:
   ```bash
   docker exec -it $(docker ps --filter "label=io.hass.name=Kiro Crew" -q) kiro-cli login
   ```
   This will display a device code and a URL. Open the URL in your browser,
   enter the code, and authenticate with your Kiro account.
4. Restart the addon after login.
5. Open "Kiro Crew" from the HA sidebar — the dashboard should load.
6. (Optional) Connect Discord/Telegram for mobile access.

> **Note:** Login credentials are stored in `/data` and persist across
> restarts and updates. You only need to do this once.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `session_pool_size` | `1` | Max concurrent agent sessions. Keep at 1 for RPi4 4GB. |
| `telemetry` | `false` | Send anonymous daily heartbeat to maintainers. |
| `log_level` | `info` | Gateway log verbosity: debug, info, warning, error. |

## RPi4 4GB optimization

This addon is tuned for low-memory devices:

- **Pool size 1**: Only one agent session runs at a time, keeping RAM below ~1.5GB.
- **Sandbox off**: Container-level isolation (provided by HA Supervisor) is
  sufficient; the OS-level sandbox is disabled to reduce overhead.
- **Embedding model**: Downloads on first use (~100MB). Falls back to keyword
  search until ready.

If you experience memory pressure, reduce other addons or consider:
- Stopping heavy addons when Kiro Crew is active
- Using `/share` for repo clones (uses disk, not RAM)

## Data storage

All Kiro Crew data lives in `/data` (mapped to HA's persistent addon storage):

```
/data/
├── config/        # Kiro Crew configuration
├── sessions/      # Persistent session state
├── models/        # Embedding model (downloaded on first use)
├── memory/        # Lessons, skills, preferences
└── .kiro/         # Kiro CLI configuration
```

This data is included in HA backups.

## Using repos

Clone your repos into `/share/repos/` (accessible via the HA Share folder):

```bash
# From the SSH addon terminal
cd /share
mkdir -p repos
cd repos
git clone https://github.com/you/your-repo.git
```

For private repos, use a GitHub Personal Access Token:
```bash
git clone https://<YOUR_PAT>@github.com/you/private-repo.git
```

The `gh` CLI is also included in the image. To authenticate it:
```bash
docker exec -it $(docker ps --filter "label=io.hass.name=Kiro Crew" -q) gh auth login --with-token <<< "YOUR_PAT"
```

Then tell Kiro Crew to work on `/share/repos/your-repo` from the dashboard.

## External access

The dashboard is accessible via HA ingress (through your existing
DuckDNS + Caddy setup). No extra port forwarding needed.

For Discord/Telegram integration, configure it inside the Kiro Crew
dashboard — these connect outbound, no inbound ports required.

## Troubleshooting

### "kiro-cli is not logged in"

You need to authenticate after first install. See [First-run setup](#first-run-setup).

### Warnings at startup (normal)

These warnings are expected and harmless:

- **`cgroup v2 scope enforcement unavailable`** — `systemd-run` isn't available
  inside a container. HA Supervisor provides isolation at the container level.
- **`MCP probe failed: timeout`** — Internal MCP services take a moment to
  start. They retry automatically.
- **`Vendored llama-cpp-python failed to import`** — The embedding model
  requires native libraries not available on all architectures. Crew falls
  back to keyword search until embeddings are available.

### Addon won't start

Check the addon logs in HA. Common causes:
- Missing Kiro CLI: The official image includes it, but verify the
  image pulled correctly.
- Port conflict: Ensure nothing else uses port 5476 internally.

### Slow first start

Normal. The embedding model (~100MB) downloads on first launch.
Subsequent starts are fast.

### Out of memory

RPi4 4GB is tight. If OOM-killed:
1. Set `session_pool_size` to 1
2. Stop other heavy addons (MariaDB, etc.) when using Crew intensively
3. Reduce HA recorder history

### Force update after a new release

If HA doesn't show a new version after a release, from the SSH addon:
```bash
ha store refresh
```

## Links

- [Kiro Crew GitHub](https://github.com/kirodotdev/KiroCrew)
- [Kiro Crew Docs](https://kiro.dev/docs/crew/)
- [Kiro Pricing](https://kiro.dev/pricing/)
