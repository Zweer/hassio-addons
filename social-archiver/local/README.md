# `local/` — maintainer's self-hosted setup

> **This folder is NOT the Home Assistant addon.** It is not released, not
> published, and not installable through Home Assistant. It is a development
> convenience for running the archiver on a regular PC on demand. This is the
> primary real-world way `social-archiver` is used.

## Why

Both sources sit behind a Cloudflare managed challenge (StoryNavigation for
Instagram; Pinterest for its internal search endpoint), so the archiver needs a
reachable [Byparr](https://github.com/ThePhaseless/Byparr) solver. Byparr runs a
real stealth browser and wants ~1 GB of RAM plus fast scratch storage — an
RPi4/4 GB running Home Assistant generally can't also host it.

This setup runs **both** Byparr and the archiver on a more capable machine (the
maintainer's PC), on demand, and writes the archive straight to the Pi over an
OS-level Samba mount of the Pi's `/share`.

## How it works

`make run` (see [Usage](#usage)):

1. **rebuilds** the archiver image from the current `src/` (via `--build`, so a
   code change always takes effect — see the note below);
2. starts **Byparr** and waits until its healthcheck reports healthy;
3. runs the archiver (built from the parent addon's `../Dockerfile`, same source
   tree — no divergent image) for **one archive pass**, then exits;
4. tears the **whole stack** down once the archiver exits.

> **Always rebuild.** `make run` passes `--build` on purpose. A plain
> `docker compose up` reuses whatever image is cached under the `local-archiver`
> tag, so after you edit the source it would silently run STALE code until a
> manual `make build`. Forcing a rebuild every run keeps `make run` honest. The
> build is cached layer-by-layer, so an unchanged tree rebuilds in seconds.

Byparr has `restart: unless-stopped` so it stays up as a long-running solver.
That means a plain `docker compose up` would leave Byparr running (and the
command hanging) after the archiver's single pass finishes. The one-shot run
uses `--abort-on-container-exit --exit-code-from archiver`, which stops every
service as soon as the archiver exits and makes the command's exit code match
the archiver's. The `Makefile` wraps this so you don't have to remember the
flags.

## Cold-start note

Byparr's **first** solve is slow: the stealth browser starts cold, and under
host memory/CPU load that initial Cloudflare solve has been seen to take
**2-3 minutes**. To keep a cold `docker compose up` reliable:

- The compose healthcheck does a **real** FlareSolverr solve and only reports
  `healthy` once Byparr proves it can clear a challenge — so the archiver's
  `depends_on: service_healthy` no longer fires while the browser is still
  warming up. The timing is generous (`start_period: 180s`, `timeout: 150s`).
  **This healthcheck (with its own timeout) is what absorbs the slow cold
  start** — not the archiver's own solve timeout.
- `SA_BYPARR_TIMEOUT_MS` (in `.env`, default `45000`) caps the archiver's own
  Byparr solve. For Pinterest the archiver solves the **home page** — which
  settles quickly — instead of the infinite-scroll search page that never
  reaches `networkidle` and used to burn the full timeout on every query. Since
  the cold start is already covered by the healthcheck above, this app-side
  timeout can stay low (45s) without risking the initial unblock.

The archiver gets its config from environment variables injected by the compose
file (`SA_BYPARR_URL`, `SA_OUTPUT_DIR`, `SA_INSTAGRAM_ACCOUNTS_FILE`,
`SA_PINTEREST_QUERIES_FILE`) plus your local `.env`. It bypasses the addon's
`run.sh` (which expects Hassio's `/data/options.json` or an in-image
`/app/.env`) by running `node dist/index.mjs` directly.

## Output → Samba mount

The archiver writes to `/archive` inside the container, bind-mounted from
`SA_HOST_OUTPUT` on the host (default `./archive`). The code is Samba-agnostic:
mount the Pi's `/share` on your PC with your OS (CIFS/SMB) and point
`SA_HOST_OUTPUT` at that mount, e.g. `/mnt/pi-share/social-archiver`. The
archive then lands on the Pi exactly as the addon would write it.

Layout on disk:

```
<output>/
  instagram/<username>/<YYYY-MM-DD>_<postid>/001.jpg|mp4 + metadata.yaml
  pinterest/<query-slug>/query.yaml
  pinterest/<query-slug>/related_searches.yaml
  pinterest/<query-slug>/<pinid>/001.jpg|mp4 + metadata.yaml
```

## Usage

```bash
cd local

cp .env.example .env                 # tweak delays, Discord webhook, SA_HOST_OUTPUT
cp accounts.txt.example accounts.txt # one public IG username per line (or empty)
cp queries.txt.example queries.txt   # one Pinterest query per line (or empty)

make run                             # Byparr → one pass → whole stack exits
```

Both `accounts.txt` and `queries.txt` are bind-mounted into the container, so
**both files must exist** even if you only use one source — leave the unused one
with just comments (empty effective list → that source is skipped).

Without the `Makefile`, the equivalent raw command is:

```bash
docker compose up --abort-on-container-exit --exit-code-from archiver
```

Other handy `make` targets: `make down` (stop and remove the stack), `make logs`
(follow logs), `make build` (rebuild the archiver image without running).

`accounts.txt`, `queries.txt`, `.env`, and `archive/` are gitignored.

## Sources

- **Instagram** — one public username per line in `accounts.txt`. Wins over any
  `SA_INSTAGRAM_ACCOUNTS`.
- **Pinterest** — one search query per line in `queries.txt`. Traversal is
  controlled by `SA_PINTEREST_DEPTH` (1 = seeds only), `SA_PINTEREST_MAX_IMAGES`
  (pins per query) and the required `SA_PINTEREST_MAX_QUERIES` (total cap).
  Related ("guided") searches are written to `related_searches.yaml` for every
  visited query, and followed only when `SA_PINTEREST_DEPTH` > 1.
