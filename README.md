# Nic's Home Assistant Addons

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
