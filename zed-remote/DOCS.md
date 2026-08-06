# Zed Remote - Documentation

## Overview

This addon provides a Debian-based SSH workspace designed specifically for
[Zed Remote Development](https://zed.dev/docs/remote-development). It runs a
full SSH server inside a container with glibc support, allowing Zed to install
and run its remote server binary on your Home Assistant hardware.

## How it works

```
Zed (your Mac/PC) → SSH → this addon (Debian container on RPi) → workspace
```

With Cloudflare Tunnel:
```
Zed (anywhere) → cloudflared proxy → SSH → this addon → workspace
```

## Configuration

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `authorized_keys` | `[]` | List of SSH public keys allowed to connect |
| `username` | `developer` | Username for SSH connections |
| `workspace_path` | `/workspace` | Path to your development workspace |

### Adding your SSH key

1. Copy your public key (usually `~/.ssh/id_ed25519.pub`)
2. Go to the addon configuration
3. Add it to `authorized_keys`:

```yaml
authorized_keys:
  - "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... your@email.com"
```

### Network

The addon exposes SSH on port **2222** on the host (mapped from container port 22).

## Cloudflare Tunnel Setup

If you already run the **Cloudflared addon** on Home Assistant, add an SSH
service to your tunnel configuration:

### In the Cloudflared addon config

Add a new public hostname entry:

| Field | Value |
|-------|-------|
| Hostname | `dev.yourdomain.com` |
| Service | `ssh://homeassistant.local:2222` |

Or if using `config.yaml` for Cloudflared:

```yaml
tunnel: your-tunnel-id
ingress:
  - hostname: dev.yourdomain.com
    service: ssh://localhost:2222
  # ... your other services
  - service: http_status:404
```

> **Note**: Use `localhost:2222` if Cloudflared runs on the same HA instance.
> The addon network is accessible via the host port mapping.

### Local SSH config (Windows)

Add this to `C:\Users\<you>\.ssh\config`:

```ssh
Host rpi-dev
    HostName dev.yourdomain.com
    User developer
    ProxyCommand cloudflared access ssh --hostname %h
    StrictHostKeyChecking no
    UserKnownHostsFile NUL
```

> **Prerequisites**: Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
> and make sure it's in your PATH (the Windows installer does this automatically).

> `StrictHostKeyChecking no` is optional — useful if you rebuild the addon
> frequently (host keys regenerate). Remove once stable.

## Connecting with Zed

### First connection

1. Open Zed
2. `Cmd+Shift+P` → **"Open Remote"** (or `File → Open Remote`)
3. Enter: `rpi-dev` (the SSH host from your config)
4. Select the folder to open (e.g., `/workspace`)
5. Zed downloads and installs its server on the first connection (~30s)

### Subsequent connections

After the first setup, connections are near-instant. The Zed server binary is
persisted in `/data/zed-server` and survives addon restarts.

## Workspace Layout

| Path | Description |
|------|-------------|
| `/workspace` | Your persistent development workspace |
| `~/ha-config` | Symlink to Home Assistant `/config` |
| `~/ha-share` | Symlink to Home Assistant `/share` |
| `~/.local/share/zed` | Zed server data (persisted in `/data`) |

## Persistence

The following data survives addon restarts and updates:

- **SSH host keys** → `/data/ssh_host_keys/`
- **Workspace files** → `/data/workspace/`
- **Zed server binary** → `/data/zed-server/`

## Tips

### Working on HA automations from Zed

Your Home Assistant config is available at `~/ha-config`. You can open it
directly in Zed:

```
Zed → Open Remote → rpi-dev → /home/developer/ha-config
```

### Port forwarding

SSH port forwarding works through the tunnel. For example, to access a service
running on the RPi at port 8080:

```bash
ssh -L 8080:localhost:8080 rpi-dev
```

### Resource usage

- **RAM**: ~50MB idle (sshd) + ~200-400MB when Zed server is active
- **Disk**: ~100MB for Zed server binary + your workspace
- **CPU**: Minimal unless running language servers or builds

## Troubleshooting

### Cannot connect

1. Check the addon is running (green indicator in HA)
2. Verify your SSH key is in the config
3. Test locally first: `ssh -p 2222 developer@homeassistant.local`
4. Check addon logs for errors

### Zed says "Failed to install remote server"

- Ensure the addon is Debian-based (not Alpine) — this addon guarantees glibc
- Check available disk space: `df -h /data`
- Check available RAM: `free -m`

### Connection drops after idle

The addon configures `ClientAliveInterval 60` to keep connections alive.
If you still get drops through Cloudflared, add to your SSH config:

```ssh
Host rpi-dev
    ServerAliveInterval 30
    ServerAliveCountMax 5
```
