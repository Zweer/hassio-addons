# Suwayomi — Home Assistant Addon

A self-hosted manga reader server ([Suwayomi / Tachidesk](https://github.com/Suwayomi/Suwayomi-Server))
that runs Mihon (Tachiyomi) extensions. Read your manga from any browser via
the Home Assistant sidebar, or from mobile/desktop clients (Mihon, Sorayomi)
locally and remotely.

## What it does

- Runs the official Suwayomi-Server image on your HA hardware.
- Serves a WebUI accessible from the HA sidebar (ingress) — no extra ports.
- Downloads manga into `/share/suwayomi` so files are accessible from other
  addons and the file editor.
- Persists your library, database, and settings in `/data` (included in HA
  backups).
- Optional authentication so you can safely expose it to clients like Mihon
  over a Cloudflare Tunnel.

## First-run setup

1. Install the addon and start it.
2. First boot downloads the WebUI (and, if enabled, the KCEF WebView) — this
   can take a minute or two.
3. Open **Suwayomi** from the HA sidebar. The WebUI should load.
4. Add an extension repository (see below) and start browsing sources.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `auth_mode` | `basic_auth` | `none`, `basic_auth`, `simple_login`, or `ui_login`. Controls login for the server. |
| `auth_username` | — | Username for authentication (required unless `auth_mode: none`). |
| `auth_password` | — | Password for authentication (required unless `auth_mode: none`). |
| `download_as_cbz` | `true` | Save downloaded chapters as CBZ archives. |
| `kcef_enabled` | `false` | Enable the KCEF WebView (needed by some sources to bypass Cloudflare). Heavy on RAM — keep off on RPi4 unless needed. |
| `web_ui_channel` | `STABLE` | WebUI update channel: `BUNDLED`, `STABLE`, or `PREVIEW`. |
| `extension_repos` | `[]` | List of extension repository URLs (Mihon-compatible `*.json`/`*.min.json`). |
| `socks_proxy_host` | — | Optional SOCKS5 proxy host for source traffic. |
| `socks_proxy_port` | — | Optional SOCKS5 proxy port. |

> **Note on ingress + auth:** the HA sidebar (ingress) is already protected by
> your Home Assistant login. When `auth_mode` is anything other than `none`,
> the Suwayomi login also applies to remote/client access. If you only ever
> read via the HA sidebar, you can set `auth_mode: none`; if you plan to use
> Mihon or expose it remotely, keep authentication on.

## Extension repositories

Suwayomi uses Mihon (Tachiyomi) extensions. Add one or more repository URLs via
the `extension_repos` option, or from the WebUI under
**Settings → Browse → Extension repos**. A repository URL looks like:

```
https://raw.githubusercontent.com/<account>/<repo>/repo/index.min.json
```

After adding a repo, install the sources you want from the **Browse** screen.

> This addon does not ship or endorse any specific extensions or sources. You
> are responsible for the repositories you add and the content you access.

## Reading from Mihon (mobile)

Suwayomi exposes itself as a *source* inside Mihon via the official
**Suwayomi/Tachidesk** extension, so your server's library appears like any
other source in Mihon.

1. In Mihon, add the Suwayomi extension repository and install the
   **Tachidesk** extension.
2. Open the extension's settings and set:
   - **Server URL Address**: your server address
     (e.g. `http://192.168.1.50:<port>` on your LAN, or your Cloudflare
     hostname `https://manga.example.com` for remote access).
   - **Login Mode**: match your addon's `auth_mode`. For `basic_auth` choose
     **Basic Authentication**.
   - **Login** / **Password**: the `auth_username` / `auth_password` you set.
3. Browse the Suwayomi source — your server library is now readable in Mihon.

> The ingress URL (HA sidebar) is **not** suitable for Mihon, because it lives
> under a dynamic `/api/hassio_ingress/<token>/` path and is gated by HA's own
> session. For clients, expose the server directly (LAN) or via a tunnel (see
> below).

## Reading from Sorayomi (official client)

[Sorayomi](https://github.com/Suwayomi/Tachidesk-Sorayomi) is the official
Suwayomi client (Android/iOS/desktop/web). Point it at the same server URL and
credentials as above.

## Remote access via Cloudflare Tunnel

The recommended way to reach Suwayomi from outside your network (for Mihon or a
browser) is the [Cloudflared HA addon](https://github.com/homeassistant-apps/app-cloudflared).

1. Install and configure the Cloudflared addon with your Cloudflare tunnel.
2. Add an additional hostname pointing at this addon's internal service:
   - **Subdomain**: e.g. `manga`
   - **Domain**: your domain (e.g. `example.com`)
   - **Service**: `http://<addon-slug>:4567`
     (the container hostname is shown in the addon logs; it looks like
     `local-suwayomi` or `<hash>-suwayomi`)
3. Keep `auth_mode: basic_auth` (or stronger) with a username/password set, so
   the publicly reachable server requires login.
4. Point Mihon/Sorayomi at `https://manga.example.com` with your credentials.

This gives you HTTPS via Cloudflare's edge with no open router ports. Because
the traffic is HTTPS end-to-end, Basic Authentication credentials are protected
in transit.

## Data storage

```
/data/
└── suwayomi/            # Suwayomi data dir (symlinked to ~/.local/share/Tachidesk)
    ├── server.conf      # generated from your options on each start
    ├── database/        # H2 database (library, history, categories)
    ├── downloads -> /share/suwayomi   # symlink to shared storage
    └── ...
/share/
└── suwayomi/            # downloaded chapters (accessible from other addons)
```

`/data` is included in Home Assistant backups. Downloaded chapter files under
`/share/suwayomi` are large and excluded from the addon's own backup config by
default.

## Notes & troubleshooting

- **First start is slow.** The WebUI (and KCEF, if enabled) download on first
  launch. Subsequent starts are fast.
- **H2 database corruption.** The default H2 database can corrupt if the
  container is killed abruptly. The addon relies on the upstream `tini` init for
  a clean shutdown; avoid force-stopping the host during writes.
- **KCEF on RPi4.** The WebView is memory-hungry. Leave `kcef_enabled: false`
  unless a source specifically needs it.
- **Downloads not appearing in /share.** The `downloads` folder is symlinked to
  `/share/suwayomi` on start; check the addon logs for the symlink step.

## Links

- [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server)
- [Suwayomi docker image](https://github.com/Suwayomi/Suwayomi-Server-docker)
- [Configuring Suwayomi-Server (wiki)](https://github.com/Suwayomi/Suwayomi-Server/wiki/Configuring-Suwayomi%E2%80%90Server)
- [Suwayomi extension for Mihon/Tachiyomi](https://github.com/Suwayomi/tachiyomi-extension)
- [Sorayomi client](https://github.com/Suwayomi/Tachidesk-Sorayomi)
