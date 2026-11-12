# Social Archiver — Home Assistant Addon

A multi-source media archiver. Archives public content from several social
sources into a single, browsable `/share` tree, for personal
inspiration/reference (outfits, landscapes, photography, locations). Runs one
pass per invocation — trigger it once a day from a HA automation — and sends a
Discord summary of what was downloaded.

> ⚠️ **Unofficial / personal use.** This addon fetches public content through
> third-party means. All media belongs to the original authors — use for
> personal, informational purposes only. Do not redistribute or pass content off
> as your own.

## Sources

| Source | Unit of work | Backed by | Status |
| --- | --- | --- | --- |
| `instagram` | a public username → its latest posts | [`@zweer/storynavigation-client`](https://github.com/Zweer/storynavigation-client) (StoryNavigation mirror) | ✅ working |
| `pinterest` | a search query → its pins + related searches | Pinterest's internal `/resource/BaseSearchResource/get/` JSON endpoint via a Byparr session | 🚧 stub (Phase A) — real impl in Phase B |

The whole thing is built on a **source-agnostic abstraction** (`src/types.ts`):
a provider takes one `target` (a username or a query) and returns one
`IngestCollection` of `IngestItem`s. The orchestration, storage and
notification code never depend on the source.

## Primary usage: `local/`

The main real-world way this runs is the `local/` Docker Compose flow on a PC
(Byparr + archiver, one pass, then exit) — **not** the Home Assistant runtime.
Byparr's stealth browser needs ~1 GB of RAM, more than a small RPi running HA
can spare. See [`local/README.md`](local/README.md).

The Home Assistant addon manifest (`config.yaml`) exists and follows the repo's
standard addon structure, but is not the center of gravity.

## What it does

- **Instagram:** polls a configurable list of public profiles, downloading
  images, videos and carousels + captions and metadata. StoryNavigation exposes
  the latest ~12 posts per profile, so the archive grows forward over time.
- **Pinterest:** takes a list of seed search queries and, up to a configurable
  `depth`, follows Pinterest's *related searches* breadth-first, archiving each
  query's pins (images and video pins) via Pinterest's internal search endpoint,
  with a Byparr session clearing Cloudflare.
- Organizes everything under the output dir (see [Layout](#storage-layout)).
- Skips already-downloaded items (state = the filesystem, no database).
- Sends a **Discord webhook** summary grouped by source.

## Storage layout

```
<output>/
  instagram/<username>/<YYYY-MM-DD>_<postid>/001.jpg|mp4 + metadata.yaml
  pinterest/<query-slug>/query.yaml                 # text, depth, provenance, timestamp
  pinterest/<query-slug>/related_searches.yaml       # always written, any depth
  pinterest/<query-slug>/<pinid>/001.jpg|mp4 + metadata.yaml
```

Instagram uses a per-post layout; Pinterest uses the same per-item layout
bucketed per query. Both share: atomic
`.partial`-then-rename commit, zero-padded 3-digit media filenames, a
`metadata.yaml` per item, and dedup by folder existence. Pinterest video pins
are treated exactly like Instagram mp4s.

The canonical item URL in `metadata.yaml` is **provided by the provider**
(Instagram: `https://www.instagram.com/p/<id>/`; Pinterest:
`https://www.pinterest.com/pin/<pinid>/`).

## Pinterest traversal semantics

- **`depth`** (1-based): `1` = only the seed queries; `2` = seeds + one level of
  related; `3` = seeds + related + related-of-related. **`depth=0` is a config
  error** (it does *not* mean unlimited) — the run fails fast at startup.
- **`max_queries`** (required): hard safety cap on the total number of queries
  visited in a run. When hit, the orchestrator stops cleanly and logs it.
- **`max_images`**: max pins archived per query.
- **Traversal order:** BFS, seed-first (seeds in config order, then related
  breadth-first).
- **Dedup:** in-memory per run — a `Set` of pin ids seen *this run*. The first
  query to encounter a pin keeps it; later queries skip it. The set starts empty
  each run (not pre-populated from disk). On top of that, a pin whose folder
  already exists on disk is skipped.
- `related_searches.yaml` is written for **every** visited query regardless of
  depth.

## Configuration

On Home Assistant, `config.yaml` exposes the options below; `run.sh` reads
`options.json` into `SA_*` env vars. Locally, the same settings come through
`SA_*` env vars via `run.sh` / `docker-compose`, with file-based lists for the
long ones (`SA_INSTAGRAM_ACCOUNTS_FILE`, `SA_PINTEREST_QUERIES_FILE`).

| Option | Env var | Notes |
| --- | --- | --- |
| `instagram.accounts` | `SA_INSTAGRAM_ACCOUNTS` / `_FILE` | public usernames |
| `pinterest.queries` | `SA_PINTEREST_QUERIES` / `_FILE` | seed search queries |
| `pinterest.depth` | `SA_PINTEREST_DEPTH` | 1-based; 0 is an error |
| `pinterest.max_images` | `SA_PINTEREST_MAX_IMAGES` | pins per query |
| `pinterest.max_queries` | `SA_PINTEREST_MAX_QUERIES` | **required**; total cap |
| `request_delay_ms` | `SA_REQUEST_DELAY_MS` | gentle-on-source delay |
| `discord_webhook_url` | `SA_DISCORD_WEBHOOK_URL` | optional |
| `notify_empty` | `SA_NOTIFY_EMPTY` | notify even with nothing new |
| `output_dir` | `SA_OUTPUT_DIR` | archive root |
| `max_download_mb` | `SA_MAX_DOWNLOAD_MB` | per-file cap |
| `byparr_url` | `SA_BYPARR_URL` | FlareSolverr-compatible solver |
| `byparr_timeout_ms` | `SA_BYPARR_TIMEOUT_MS` | raise for slow cold solve |

## Development

```bash
npm install
npm run typecheck
npm run build      # → dist/index.mjs (self-contained, minified)
npm run dev        # tsx src/index.ts (needs SA_* env / files)
```

See [CHANGELOG.md](CHANGELOG.md) and [DOCS.md](DOCS.md).
