# RomM — Home Assistant Addon

A self-hosted **ROM library manager and in-browser player** ([RomM](https://github.com/rommapp/romm)).
Scan your game collection, enrich it with metadata and artwork from IGDB,
ScreenScraper, MobyGames and more, and play retro games straight from your
browser via EmulatorJS. Designed to pair with a Prowlarr/\*arr download flow and
the existing MariaDB addon, and tuned to share a Raspberry Pi 4 with Home
Assistant.

## What it does

- Runs the official `rommapp/romm` image on your HA hardware (aarch64 + amd64).
- Serves the RomM web UI on a host port you choose (default 8080; change it in
  the addon's **Network** tab if that port is taken).
- Scans ROMs from `/share/romm/library/roms` — shared storage your download
  client can write to, and the file editor can see.
- Uses your **existing MariaDB addon** as the database (no second DB engine
  wasting RAM on the Pi).
- Keeps everything in one tidy folder, `/share/romm` (library, downloaded
  artwork, saves, config, auth secret), included in HA backups.
- Plays PS1, N64, SNES, GBA, Mega Drive, PSP, Saturn and more in the browser.

## Prerequisites

- The **MariaDB** addon installed and running.
- (Recommended) IGDB API credentials for metadata — free, see below.

## First-run setup

### 1. Create the database in MariaDB

Open the **MariaDB** addon configuration and add a database and a user. Example
addon options:

```yaml
databases:
  - romm
logins:
  - username: romm
    password: choose-a-strong-password
rights:
  - username: romm
    database: romm
```

Restart the MariaDB addon so the database and user are created.

### 2. Configure this addon

In the **Configuration** tab, set at least:

| Option | Value |
|--------|-------|
| `db_host` | `core-mariadb` (the MariaDB addon's hostname) |
| `db_name` | `romm` |
| `db_user` | `romm` |
| `db_password` | the password you set above |

The addon refuses to start while `db_password` is empty.

### 3. (Recommended) Add IGDB metadata credentials

IGDB is the primary metadata provider (covers, descriptions, release info). The
IGDB API is accessed through a Twitch application, so you need a Twitch account
with a phone number set (required for the developer console).

1. Sign in to the [Twitch Developer Console](https://dev.twitch.tv/console/apps)
   and click **Register Your Application**.
2. Fill out the form exactly like this:

   | Field | Value |
   |-------|-------|
   | **Name** | Something **unique/random**, e.g. `romm-<random-hash>`. A name already taken by someone else fails *silently* — don't use a generic name like "romm". |
   | **OAuth Redirect URLs** | `localhost` |
   | **Category** | `Application Integration` |
   | **Client Type** | `Confidential` (Italian: **Informazioni riservate**) |

   > **Client Type must be `Confidential`.** If you pick `Public` (Italian:
   > *Pubblico*), Twitch shows **no Client Secret at all** — public clients
   > cannot hold one — and RomM's client-credentials flow needs it. Choose
   > *Confidential* / *Informazioni riservate*, save, then use the **New Secret**
   > button on the app page to generate the secret.

   > **About the redirect URL:** RomM uses the OAuth *client-credentials* flow
   > (server-to-server), which never actually performs a redirect. Twitch still
   > requires the field to be non-empty, so any valid URL works (`localhost` is
   > the simplest) — it is never used.

3. Create the app. On the app management page, note the **Client ID** and click
   **New Secret** to generate the **Client Secret** (only available for a
   Confidential client).
4. Put them in `igdb_client_id` / `igdb_client_secret`.

You can add other providers too (MobyGames, ScreenScraper, SteamGridDB,
RetroAchievements). Without any provider, scans still work but find no artwork.
For most users RomM recommends the combo **Hasheous + IGDB + SteamGridDB +
RetroAchievements**.

### 4. Start and open

Start the addon, then open `http://<home-assistant-ip>:<port>`, where `<port>`
is the host port shown in the addon's **Network** tab (8080 by default). Complete
the RomM
setup wizard (create your admin user) and run your first scan.

## How the download flow fits (Prowlarr / \*arr)

RomM does **not** download anything itself — it manages what is already on disk.
The realistic flow with your existing setup:

```
Prowlarr (manual multi-indexer search: Console/PSx, PC/Games, ...)
   -> your download client (qBittorrent/Transmission)
      -> downloads into /share/romm/library/roms/<platform>
         -> RomM scans the library and enriches with metadata
            -> Play PS1/N64/SNES/... in the browser (EmulatorJS)
```

There is no Radarr-style automation for games (no "monitor the whole PS1
collection"); Prowlarr's manual search + send-to-client is the practical path.

### Folder layout for ROMs

RomM uses its default "Structure A" layout under `/share/romm/library`: games
go in `roms/<platform>/`, and (optional) firmware in `bios/<platform>/`. The
addon **auto-creates a folder per platform** on start, from the
`create_platform_folders` option — so your download client has a ready target
and the platforms show up in RomM without any manual `mkdir`. Edit that list to
add or remove consoles (use the exact RomM **slug**, matched case-insensitively):

```
/share/romm/library/
├── roms/
│   ├── psx/        (PlayStation 1)
│   ├── ps2/        (PlayStation 2 — catalogued, not browser-playable)
│   ├── n64/        (Nintendo 64)
│   ├── snes/       (Super Nintendo)
│   ├── nes/        (Nintendo Entertainment System)
│   ├── gba/        (Game Boy Advance)
│   └── genesis/    (Sega Mega Drive; alias "megadrive" also works)
└── bios/
    ├── psx/        (PS1 BIOS, e.g. scph1001.bin — needed to play PS1)
    └── ps2/
```

Common slugs: `psx` (PS1, alias `ps`), `ps2`, `n64`, `snes`, `nes`, `gb`, `gbc`,
`gba`, `genesis`/`megadrive`, `saturn`, `psp`. See the full list in the
[RomM folder-structure docs](https://docs.romm.app/latest/getting-started/folder-structure/)
and [supported platforms](https://docs.romm.app/latest/Platforms-and-Players/Supported-Platforms/).

## What can be played in the browser

In-browser play uses **EmulatorJS**, which supports (non-exhaustive): PS1, PSP,
N64, NDS, GB/GBC/GBA, NES, SNES, Virtual Boy, Sega Master System/Game Gear/Mega
Drive/32X/CD/Saturn, Atari 2600/5200/7800/Jaguar/Lynx, 3DO, ColecoVision,
Commodore, MAME 2003.

**Not** playable in the browser: PS2, GameCube, Wii, Switch, PS3, Dreamcast.
RomM can still *catalogue* these (400+ platforms), but you need a desktop
emulator (e.g. PCSX2 for PS2) to play them — and PS2 is not realistic on a Pi 4
anyway.

## Configuration reference

| Option | Default | Description |
|--------|---------|-------------|
| `db_host` | `core-mariadb` | MariaDB addon hostname. |
| `db_port` | `3306` | MariaDB port. |
| `db_name` | `romm` | Database name (must exist in MariaDB). |
| `db_user` | `romm` | Database user. |
| `db_password` | — | Database password (**required**). |
| `kiosk_mode` | `false` | Let visitors browse read-only without logging in. |
| `https_cookies` | `false` | Mark session cookies Secure — enable when served over HTTPS (Cloudflare Tunnel). |
| `igdb_client_id` | — | IGDB (Twitch) client id. |
| `igdb_client_secret` | — | IGDB (Twitch) client secret. |
| `mobygames_api_key` | — | MobyGames API key. |
| `screenscraper_user` | — | ScreenScraper username. |
| `screenscraper_password` | — | ScreenScraper password. |
| `steamgriddb_api_key` | — | SteamGridDB API key (custom artwork). |
| `retroachievements_api_key` | — | RetroAchievements API key. |
| `hasheous_api_enabled` | `true` | Enable the free, keyless Hasheous hash-lookup provider. |
| `emulatorjs_enabled` | `true` | Enable in-browser play via EmulatorJS. |
| `ruffle_enabled` | `true` | Enable in-browser Flash playback (RuffleRS). |
| `jsdos_enabled` | `true` | Enable in-browser DOS/Win3.x playback (js-dos). |
| `pico8_enabled` | `true` | Enable in-browser PICO-8 playback. |
| `scheduled_rescan` | `false` | Re-scan the library on a schedule (cron). |
| `scheduled_rescan_cron` | `0 3 * * *` | Cron expression for the scheduled re-scan. |
| `rescan_on_filesystem_change` | `false` | Re-scan automatically when files change under the library. |
| `scan_workers` | `3` | Parallel ROMs per scan. 3 leaves a core for HA on a Pi 4. |
| `web_server_concurrency` | `2` | API worker processes. Kept low so HA stays responsive. |
| `scan_timeout` | `86400` | Seconds before a scan job is killed (24h; first scans are slow). |
| `log_level` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL`. |
| `create_platform_folders` | popular consoles | List of platform slugs auto-created under `library/roms` on start. Edit to add/remove consoles. |

## Changing the web port

RomM listens on port **8080 inside the container**, which is isolated and never
conflicts with anything on your host. What you expose on the host is separate:

- The addon publishes RomM on host port **8080 by default**. If that port is
  already taken (e.g. by qBittorrent), open the addon's **Network** tab, change
  the "RomM web interface" host port to a free one (e.g. `8096`) and save.
- Access RomM on your LAN at `http://<home-assistant-ip>:<that-port>`.
- A **Cloudflare Tunnel** always targets the internal `http://<slug>:8080` and
  is unaffected by the host port you choose.

## Remote access via Cloudflare Tunnel

RomM has no ingress (its nginx serves from the root and cannot be mounted under
the HA ingress sub-path). To reach it from outside your network, use the
[Cloudflared addon](https://github.com/brenner-tobias/addon-cloudflared):

1. Configure the Cloudflared addon with your tunnel.
2. Add a hostname pointing at this addon's service:
   - **Service**: `http://<addon-slug>:8080` (the container hostname shown in
     the addon logs, e.g. `local-romm` or `<hash>-romm`). Always use the
     **internal** port `8080` here — it is fixed inside the container and does
     not change even if you pick a different host port in the Network tab.
3. Set `https_cookies: true` in this addon so session cookies are marked Secure.
4. Protect the hostname with Cloudflare Access (or keep RomM's own login on).

## Performance notes (Raspberry Pi 4)

- **The Pi does the library work; your browser does the emulation.** RomM's
  backend is light; the heavy part (running the game) happens on the client
  device that opens the Play page.
- **First scan is slow** and bound by metadata-provider latency, not disk. A
  large library can take hours — hence the 24h `scan_timeout` default.
- `scan_workers: 3` and `web_server_concurrency: 2` deliberately leave headroom
  for Home Assistant. Raise them only if HA has spare cores/RAM.

## Data storage

```
/share/romm/
├── library/
│   ├── roms/            # your ROMs, one subfolder per platform
│   │   ├── psx/
│   │   ├── snes/
│   │   └── ...
│   └── bios/            # optional firmware, one subfolder per platform
│       └── psx/
├── resources/           # downloaded covers/screenshots
├── assets/              # saves, states, screenshots
└── config/              # RomM config
/data/
└── .auth_secret         # generated once; keeps sessions valid across restarts
```

Everything lives under a single `/share/romm` folder, so it is easy to back up
or move to external storage later (just relocate that one folder). It is a
single filesystem, so the hardlinks RomM makes between these subfolders work.

## Links

- [RomM](https://github.com/rommapp/romm) · [Docs](https://docs.romm.app/) · [Supported platforms](https://docs.romm.app/latest/Platforms-and-Players/Supported-Platforms/)
- [EmulatorJS](https://emulatorjs.org/docs/systems)

---

The addon wrapper takes inspiration from the community
[edrianolima/home-assistant-addons](https://github.com/edrianolima/home-assistant-addons)
RomM addon (MIT).
