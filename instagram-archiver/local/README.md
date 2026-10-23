# `local/` — maintainer's self-hosted setup

> **This folder is NOT the Home Assistant addon.** It is not released, not
> published, and not installable through Home Assistant. It is a development
> convenience for running the archiver on a regular PC on demand.

## Why

StoryNavigation now sits behind a Cloudflare managed challenge, so the archiver
needs a reachable [Byparr](https://github.com/ThePhaseless/Byparr) solver.
Byparr runs a real stealth browser and wants ~1 GB of RAM plus fast scratch
storage — an RPi4/4 GB running Home Assistant generally can't also host it.

This setup runs **both** Byparr and the archiver on a more capable machine (the
maintainer's PC), on demand, and writes the archive straight to the Pi over an
OS-level Samba mount of the Pi's `/share`.

## How it works

`docker compose up`:

1. starts **Byparr** and waits until its healthcheck reports healthy;
2. builds the **archiver** from the parent addon's `../Dockerfile` (same source
   tree — no divergent image) and runs **one archive pass**, then exits.

## Cold-start note

Byparr's **first** solve is slow: the stealth browser starts cold, and under
host memory/CPU load that initial Cloudflare solve has been seen to take
**2-3 minutes**. To keep a cold `docker compose up` reliable:

- The compose healthcheck does a **real** FlareSolverr solve (a `request.get`
  against `example.com`) and only reports `healthy` once Byparr proves it can
  clear a challenge — so the archiver's `depends_on: service_healthy` no longer
  fires while the browser is still warming up. The healthcheck timing is
  generous (`start_period: 180s`, `timeout: 150s`) to allow for that cold solve.
- `IA_BYPARR_TIMEOUT_MS` (in `.env`, default `180000`) raises the archiver's own
  Byparr solve timeout above the client's 60s default, so the first real solve
  doesn't abort before Byparr finishes. A fresh `cp .env.example .env` is
  already set up for this.

The archiver gets its config from environment variables injected by the compose
file (`IA_BYPARR_URL`, `IA_OUTPUT_DIR`, `IA_ACCOUNTS_FILE`) plus your local
`.env`. It bypasses the addon's `run.sh` (which expects Hassio's
`/data/options.json` or an in-image `/app/.env`) by running `node dist/index.mjs`
directly.

## Output → Samba mount

The archiver writes to `/archive` inside the container, bind-mounted from
`IA_HOST_OUTPUT` on the host (default `./archive`). The code is Samba-agnostic:
mount the Pi's `/share` on your PC with your OS (CIFS/SMB) and point
`IA_HOST_OUTPUT` at that mount, e.g. `/mnt/pi-share/instagram`. The archive then
lands on the Pi exactly as the addon would write it.

## Usage

```bash
cd local

cp .env.example .env                 # tweak delays, Discord webhook, IA_HOST_OUTPUT
cp accounts.txt.example accounts.txt # one public username per line

docker compose up                    # Byparr → one pass → exit
```

`accounts.txt`, `.env`, and `archive/` are gitignored.

## Accounts

List one public Instagram username per line in `accounts.txt`. Blank lines and
anything after a `#` are ignored. This file wins over any `IA_ACCOUNTS`.
