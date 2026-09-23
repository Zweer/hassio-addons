# Zweer's Home Assistant Addons

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Custom Home Assistant addons for my setup.

## Addons

### 🤖 [Kiro Crew](kirocrew/)

A persistent AI development workspace that runs [Kiro Crew](https://kiro.dev/crew/) on your HA hardware.

- Ingress integration (dashboard in HA sidebar)
- Long-running AI tasks, scheduled jobs, multi-session memory
- Optimized for RPi4 4GB
- Access via Discord/Telegram while away

### 💻 [Zed Remote](zed-remote/)

SSH workspace for [Zed Remote Development](https://zed.dev/docs/remote-development) on your HA hardware.

- Debian-based container (glibc) — compatible with Zed Remote server
- SSH server with public key authentication
- Persistent workspace, Zed server data, and SSH host keys
- Works with Cloudflare Tunnel for remote access from anywhere
- Access to HA config and shared storage from the workspace

### ⚔️ [Lares Bot](lares-bot/)

Automated strategy bot for Lares running 24/7 on your HA hardware.

- Optimized build queue, faith powers, spying, and raids
- Configurable polling interval (default 20s)
- Discord webhook notifications
- Local build — no CI needed, just `./deploy.sh`

### 📚 [Suwayomi](suwayomi/)

Self-hosted manga reader server ([Suwayomi/Tachidesk](https://github.com/Suwayomi/Suwayomi-Server)) running on your HA hardware.

- Runs Mihon (Tachiyomi) extensions, reads from any browser via ingress
- Readable from Mihon/Sorayomi clients locally or remotely (Cloudflare Tunnel)
- Optional authentication (basic/simple/ui login) for safe remote access
- Downloads into `/share/suwayomi`; library and settings persisted in `/data`
- Based on the official upstream Docker image (arm64 + amd64)

### 🎮 [RomM](romm/)

Self-hosted ROM library manager and in-browser player ([RomM](https://github.com/rommapp/romm)) running on your HA hardware — a "Plex for retro games".

- **Fits the \*arr flow:** search games in Prowlarr, send them to your existing download client, and drop them into `/share/romm/library/roms`. RomM scans that folder, organizes by platform, and enriches each title with metadata and artwork.
- **Play in the browser (EmulatorJS):** PS1, PSP, N64, NDS, GB/GBC/GBA, NES, SNES, Mega Drive/32X/CD, Master System, Game Gear, Saturn, Atari, and more — no client install. PS2/GameCube/Wii/Switch can be catalogued but not played in-browser.
- **Metadata providers:** IGDB (primary), MobyGames, ScreenScraper, SteamGridDB, RetroAchievements and keyless Hasheous — all optional.
- **Uses the existing MariaDB addon** (`core-mariadb`) — no second database engine wasting RAM on the Pi.
- **Highly configurable:** per-player emulation toggles, scheduled/filesystem-triggered re-scans, kiosk mode, HTTPS-secure cookies; scan/web workers tuned to leave headroom for HA on an RPi4 4GB.
- **Access:** LAN on a port you pick (no ingress — RomM's nginx serves from root), or remotely via Cloudflare Tunnel with secure cookies. Based on the official image (arm64 + amd64).

See [`romm/DOCS.md`](romm/DOCS.md) for the full setup guide (MariaDB database, IGDB credentials, folder layout, Cloudflare).

## Installation

Add this repository to your Home Assistant addon store:

[![Add repository](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FZweer%2Fhassio-addons)

Or manually: **Settings → Add-ons → Add-on Store → ⋮ → Repositories** → paste:
```
https://github.com/Zweer/hassio-addons
```

## Hardware

| Hardware | RAM | Kiro Crew |
|----------|-----|-----------|
| RPi4 4GB | 4GB | ✅ (pool_size=1) |
| RPi4 8GB | 8GB | ✅ (pool_size=2) |
| NUC / Mini-PC | 8-16GB | ✅ Full features |

## License

MIT — see [LICENSE](LICENSE).
