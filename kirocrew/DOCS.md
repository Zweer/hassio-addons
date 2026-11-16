# Kiro Crew — Home Assistant Addon

A persistent AI development workspace that self-improves and continues
beyond one session.

## What it does

Kiro Crew runs as an always-on gateway on your Home Assistant hardware.
It orchestrates AI agents for long-running tasks, scheduled jobs, and
multi-session work. The dashboard is served on port 5476.

## Features

- **Persistent sessions**: Conversations, task state and the Kiro CLI login
  survive restarts, updates and container recreation.
- **Self-learning**: Corrections become durable lessons; repeated patterns
  become reusable skills.
- **Scheduled work**: Cron jobs, webhooks, and heartbeats run unattended.
- **Multi-surface**: Also reachable via Discord, Telegram, or Slack.
- **Node.js included**: Node.js LTS and npm are in the image for Node projects.

## First-run setup

1. Install the addon and start it. The first start downloads the embedding
   model (about 610 MB) in the background.
2. **Sign in to Kiro CLI.** Agents cannot work until you do. Open a shell in
   the addon container (SSH/Terminal addon with protection mode off):
   ```bash
   docker exec -it $(docker ps --filter "label=io.hass.name=Kiro Crew" -q) kiro-login --use-device-flow
   ```
   Open the printed URL, enter the code and sign in. Alternatively, set the
   **Kiro API Key** option for headless sign-in.
3. **Get a dashboard login link:**
   ```bash
   docker exec -it $(docker ps --filter "label=io.hass.name=Kiro Crew" -q) kiro-token
   ```
   The link is valid for 24 hours (`kiro-token 7d` for longer). It is printed
   to your terminal only, never to the addon log. Replace `localhost` in the
   link with how you reach the addon: `http://<ha-host>:5476` on your LAN, or
   your External URL.

> Always use `kiro-login` and `kiro-token` instead of running `kiro-cli` or
> `kirocrew` directly as root: the helpers run as the `kirocrew` user with
> `HOME=/data/home`, the same environment as the gateway.

## Configuration

The addon manages the keys below in `config.json` on every start. Settings
you change in the dashboard are kept.

| Option | Default | Kiro Crew key | Description |
|--------|---------|---------------|-------------|
| `session_timeout_secs` | `900` | `session.timeout_secs` | Close an idle agent session (and its kiro-cli process) after this many seconds. |
| `watchdog_rss_max_mb` | `1536` | `session.watchdog_rss_max_mb` | Recycle an idle session using more memory than this. `0` disables. |
| `embedding_idle_evict_secs` | `300` | `memory.embedding_idle_evict_secs` | Unload the embedding model after this many idle seconds. `0` keeps it loaded. |
| `embedding_weight_repack` | `false` | `memory.embedding_weight_repack` | Faster embedding at the cost of about 450 MB more RAM while the model is loaded. |
| `telemetry` | `false` | `telemetry.beacon_enabled` | Anonymous daily heartbeat to the Kiro Crew maintainers. |
| `log_level` | `info` | `agent.log_level` | Gateway log verbosity. |
| `kiro_api_key` | | `.env` `KIRO_API_KEY` | Headless sign-in instead of `kiro-login`. |
| `external_url` | | `dashboard.url` | Public URL (Cloudflared). Empty: Home Assistant's own external URL. |
| `telegram_*`, `discord_*`, `slack_*` | | channel sections and `.env` | Chat integrations. |

Always set by the addon:

- `session.pool_size: 0`, so no kiro-cli processes are kept warm.
- `agent.sandbox: auto` with `sandbox_allow_unsandboxed_exec: true`. Home
  Assistant's AppArmor profile blocks user namespaces, so agent commands run
  without Kiro Crew's inner sandbox and the addon container is the isolation
  boundary. If a sandbox backend works, it is used.

Secrets (API key, bot tokens) are moved into `/data/home/.kiro/crew/.env`
(mode 600) and removed from the process environment. Clearing an option does
not delete its value from `.env`; edit that file to remove it.

## Memory on a Raspberry Pi 4 (4 GB)

Measured on amd64 with a 3 GB limit: the idle gateway uses about 360 MiB.
Loading the embedding model and running an agent session add much more. A
single kiro-cli session can use 1.4–2.6 GB with many MCP servers. With Home
Assistant and other addons on a 4 GB Pi, run one session at a time and keep
the defaults above. Swap on a microSD card wears it out; prefer zram or an
SSD.

## Data storage

Everything lives under `/data/home`, the `kirocrew` user's HOME:

```
/data/home/
├── .kiro/crew/            # Kiro Crew data: config.json, .env, sessions, memory
├── .kiro/crew/models/     # Embedding model (excluded from backups)
└── .local/share/kiro-cli/ # Kiro CLI login
```

Versions 0.2.x stored data in `/data/dot-kiro`; it is moved to
`/data/home/.kiro` automatically on the first start.

## Using repos

Clone your repos into `/share/repos/` (accessible via the HA Share folder):

```bash
cd /share && mkdir -p repos && cd repos
git clone https://github.com/you/your-repo.git
```

The `gh` CLI is included. Authenticate it as the `kirocrew` user:

```bash
docker exec -it -u kirocrew $(docker ps --filter "label=io.hass.name=Kiro Crew" -q) gh auth login
```

Then tell Kiro Crew to work on `/share/repos/your-repo` from the dashboard.

## External access

The recommended way to reach Kiro Crew remotely is the
[Cloudflared HA addon](https://github.com/homeassistant-apps/app-cloudflared).

1. Install the Cloudflared addon and configure your tunnel.
2. Add an additional hostname with **Service** `http://<kirocrew-container-hostname>:5476`
   (for example `http://bd513314-kirocrew:5476`).
3. Set the Kiro Crew **External URL** option to the public hostname
   (for example `https://kiro.example.com`) and restart the addon.

### Why not HA ingress?

HA ingress serves addons under a sub-path (`/api/hassio_ingress/...`).
Kiro Crew's SPA uses absolute paths for assets and API calls, which break
under a sub-path, so the dashboard is exposed on port 5476 instead.

## Troubleshooting

### "kiro-cli is not logged in"

Run `kiro-login` as shown in [First-run setup](#first-run-setup). A login
made with `kiro-cli login` as root is stored in the wrong place and is not
seen by the gateway.

### Warnings at startup (normal)

- **`cgroup v2 scope enforcement unavailable`**: `systemd-run` is not
  available inside a container.
- **`userns probe failed ... EPERM`** / **`no OS-level sandbox backend`**:
  expected under Home Assistant's AppArmor profile; see Configuration.
- **`superseded default: session.watchdog_rss_max_mb`**: harmless. The value
  comes from the `watchdog_rss_max_mb` option.

### Out of memory

1. Lower `session_timeout_secs` and `embedding_idle_evict_secs`.
2. Keep `embedding_weight_repack` off.
3. Stop other heavy addons (MariaDB, etc.) when using Crew intensively.

### Force update after a new release

```bash
ha store refresh
```

## Links

- [Kiro Crew GitHub](https://github.com/kirodotdev/KiroCrew)
- [Kiro Crew Docs](https://kiro.dev/docs/crew/)
- [Kiro Pricing](https://kiro.dev/pricing/)
