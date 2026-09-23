# Instagram Archiver — Home Assistant Addon

Archives posts from public Instagram profiles onto your HA hardware, for
personal inspiration/reference (outfits, landscapes, photography, locations).
Runs headless on a Raspberry Pi, polled once a day, and organizes everything
neatly into `/share`.

> ⚠️ **Unofficial / personal use.** This addon fetches public Instagram content
> through the third-party mirror [StoryNavigation](https://storynavigation.com)
> via the [`@zweer/storynavigation-client`](https://github.com/Zweer/storynavigation-client)
> library. All media belongs to the original authors — use for personal,
> informational purposes only. Do not redistribute or pass content off as your own.

## Status

✅ **Implemented (0.1.0).** Node/TypeScript, consuming `@zweer/storynavigation-client`.
Verified end-to-end against live accounts (images, videos, carousels download
correctly; dedup and atomic commit confirmed).

## What it does

- Polls a configurable list of public Instagram profiles (≈10 accounts).
- Downloads **images, videos, and carousels**, plus captions and metadata.
- Organizes everything under `/share/instagram/` so files are browsable from
  other addons and the file editor.
- Skips already-downloaded posts (state = the filesystem, no database).
- Sends a **Discord webhook** summary of what was downloaded.
- Triggered **once a day via a HA cron/automation** (not an internal scheduler).

## Data source & scope (important)

The daily job uses **StoryNavigation** as its data provider. A key, verified
limitation carries over from that source:

> StoryNavigation only exposes the **latest ~12 posts** per profile
> (confirmed across accounts with hundreds/thousands of posts). See the
> [`storynavigation-client` README](https://github.com/Zweer/storynavigation-client)
> for the full reverse-engineering write-up.

**Consequence:**

- **Daily polling → StoryNavigation.** Perfect for capturing new posts as they
  appear. Run daily, the archive grows forward over time.
- **Full-history backfill → out of scope here.** Every free mirror capable of
  full history is behind Cloudflare/Turnstile (see the client README's
  alternatives table). Backfill is planned as a **separate project** (a
  Tampermonkey userscript that captures posts from a logged-in browser and
  pushes them to this addon — see [Shared ingest endpoint](#shared-ingest-endpoint-future)).

## Folder layout

```
/share/instagram/
└── <username>/
    └── <YYYY-MM-DD>_<postid>/
        ├── 001.jpg        # single image, or…
        ├── 001.jpg        # carousel slide 1
        ├── 002.mp4        # carousel slide 2 (video), etc. — zero-padded to 3 digits
        └── metadata.yaml  # caption + post metadata
```

- Media files are **zero-padded to 3 digits** (`001`, `002`, …).
- One folder per post, named `<date>_<postid>`.
- A post folder already existing = post already archived (dedup by filesystem).

### `metadata.yaml`

```yaml
id: DaD1mynjH8E
type: sidecar            # image | video | sidecar
url: https://www.instagram.com/p/DaD1mynjH8E/
created_time: "2026-06-26T18:57:05"
caption: |
  🤍
likes_count: 116601
comments_count: 2054
media:
  - file: 001.jpg
    kind: image
  - file: 002.jpg
    kind: image
downloaded_at: "2026-09-23T15:00:00"
source: storynavigation
```

## Configuration (planned)

| Option | Default | Description |
|--------|---------|-------------|
| `accounts` | `[]` | List of public Instagram usernames to archive. |
| `discord_webhook_url` | — | Discord webhook for download summaries (optional). |
| `discord_notify_empty` | `false` | Send a message even when nothing new was found. |
| `request_delay_ms` | `1500` | Delay between requests to be gentle on the source. |
| `output_dir` | `/share/instagram` | Where to store the archive. |

Triggering is external: a HA automation/cron calls the addon once a day.

## Discord notifications (planned behavior)

- **Bootstrap (first time an account is seen):** a single terse summary message
  (potentially many posts at once) — no per-image previews to avoid spam.
  e.g. `📦 Archivio inizializzato: heyjoanar — 12 post`.
- **Daily runs:** a **summary message** in the channel
  (`📥 3 nuovi post — heyjoanar (2), altro (1)`), and, when there are new posts,
  a **thread** attached to it with **one message per account** showing previews.
  Discord webhooks can post into a thread via `?thread_id=` (or create one via
  `thread_name` on a forum channel).
- **Nothing new:** silent by default (`discord_notify_empty: false`).
- Long summaries are split to respect Discord's per-message character limit.

How bootstrap vs. daily is decided: if the account's folder doesn't exist yet →
bootstrap for that account.

## Architecture (planned)

Node/TypeScript (to consume the TS client directly — no Python bridge).

```
instagram-archiver/
├── config.yaml          # HA addon manifest + options schema
├── Dockerfile           # node on arm64/amd64
├── run.sh               # entrypoint: read options, run one archive pass
├── src/
│   ├── index.ts         # orchestration: loop accounts, dedup, download, notify
│   ├── provider.ts      # IngestProvider interface (source-agnostic)
│   ├── providers/
│   │   └── storynavigation.ts   # first provider (uses @zweer/storynavigation-client)
│   ├── storage.ts       # folder layout + metadata.yaml writing + dedup
│   └── notify.ts        # Discord webhook (summary + per-account thread)
├── DOCS.md
└── CHANGELOG.md
```

The **provider abstraction** is the key design choice: the orchestrator only
knows an `IngestProvider` that yields `Post[]` + downloadable media. Today the
only implementation is StoryNavigation; other sources (see below) plug in
without touching orchestration, storage, or notifications.

## Shared ingest endpoint (future)

> 📌 **Design note (agreed 2026-09-23).** The full-history **backfill** will be a
> separate project — a **Tampermonkey userscript** that runs in a logged-in
> browser, intercepts Instagram's GraphQL responses while you scroll a profile,
> downloads the media bytes in-browser (via `GM_xmlhttpRequest` to bypass CORS),
> and pushes them to this addon.
>
> To make that future project plug in cleanly, **design this addon with a generic
> ingest endpoint from day one**:
>
> - `POST /ingest` accepting a post + its media **bytes** (not URLs — Instagram
>   media URLs are signed and IP/session-bound, so they must be downloaded by
>   whoever holds the valid session; the browser, in that case).
> - Both the StoryNavigation provider and the future userscript feed the **same**
>   ingest path → identical folder layout, metadata, dedup, and Discord summary.
>
> Cost now: essentially zero (factor storage/dedup/notify behind an ingest
> function). Benefit later: the userscript backfill attaches with no addon changes.

## Runtime footprint (low memory)

Tuned to stay light on an RPi4:

- **Alpine base image.** Built on `node:24-alpine` (~50 MB vs ~75 MB for
  `-slim`). Safe here because the only dependency is pure TypeScript using the
  global `fetch` — no native modules, so no glibc/musl concerns.
- **Pre-built bundle.** A multi-stage Docker build compiles `src/` into a single
  minified, self-contained `dist/index.mjs` (all deps inlined, ~13 kB). The
  runtime image ships **no `node_modules` and no `tsx`** — it runs with plain
  `node dist/index.mjs` (no runtime transpilation, minimal resident memory).
- **One pass, then exits.** No long-running process or internal scheduler — the
  addon is idle (zero RAM) between the daily triggers.
- Downloads are serialized with a delay, so memory stays flat regardless of how
  many posts are fetched.

## Triggering (daily)

The addon runs **one pass per start and exits** — it has no internal scheduler.
Trigger it once a day from a HA automation, e.g.:

```yaml
automation:
  - alias: "Instagram Archiver — daily"
    trigger:
      - platform: time
        at: "04:30:00"
    action:
      - service: hassio.addon_start
        data:
          addon: local_instagram-archiver   # slug may differ by install
```

## Development

Run locally without Home Assistant:

```bash
npm install
cp .env.example .env        # set IA_ACCOUNTS etc.
npm start                   # tsx src/index.ts — one pass, then exits
npm run typecheck
```

Config comes from `/data/options.json` on Hassio (mapped by `run.sh` into
`IA_*` env vars) or from `.env` locally. Built and deployed via the repo's
standard local build flow (`node:24-alpine`, `run.sh` entrypoint).

## License

MIT
