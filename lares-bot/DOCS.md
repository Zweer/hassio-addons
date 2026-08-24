# Lares Bot

Automated strategy bot for Lares. Runs 24/7 on your Home Assistant hardware, handling builds, troops, faith powers, spying, and resource optimization.

## How it works

On first start, the addon clones the private repos using your GitHub PAT, builds the bot, and starts it. The build is cached in persistent storage — subsequent restarts skip the build step.

The bot polls the Lares API at a configurable interval and executes optimized strategies:

- **Build Planner** — queues optimal building upgrades
- **Power Scheduler** — casts faith powers on cooldown
- **Spy Manager** — automates espionage missions
- **Sacrifice Raids** — manages offensive raids
- **Resource Optimization** — balances production and consumption

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `github_pat` | GitHub Personal Access Token (fine-grained, `contents:read` on both repos) | — |
| `lares_api_url` | Base URL of the Lares API | — |
| `lares_token` | Session token (from browser `localStorage` key `bg.session`) | — |
| `lares_village_id` | Your village name/ID | — |
| `lares_poll_interval` | Polling interval in seconds | `20` |
| `discord_webhook_url` | Discord webhook for log forwarding (optional) | — |

### GitHub PAT setup

1. Go to [GitHub Settings → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Create a token with **Repository access** → select `Zweer/lares-bot` and `vanilla-studio/lares`
3. Permissions: **Contents** → Read-only
4. Copy the token into the addon configuration

### Getting your game token

1. Open the game in your browser
2. Open DevTools → Console
3. Run: `localStorage.getItem('bg.session')`
4. Copy the value into the addon configuration

> **Note:** The token may expire. If the bot stops working, refresh the token.

## Updating

To pull the latest code and rebuild, use the Home Assistant service call:

**Settings → Developer Tools → Services:**

```yaml
action: hassio.addon_stdin
data:
  addon: lares-bot
  input:
    command: rebuild
```

Or create a button in your dashboard:

```yaml
type: button
name: Rebuild Lares Bot
tap_action:
  action: perform-action
  perform_action: hassio.addon_stdin
  data:
    addon: lares-bot
    input:
      command: rebuild
```

The addon will re-clone both repos, rebuild, and restart the bot automatically.

## Logs

Logs are visible in the Home Assistant addon log panel. If `discord_webhook_url` is configured, important events are also forwarded to Discord.
