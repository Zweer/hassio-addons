# Changelog

## 0.1.0 (Phase A)

- Initial scaffold of the multi-source `social-archiver` addon, built on a
  source-agnostic `IngestProvider` / `IngestItem` / `IngestCollection`
  abstraction (`collection → item`, generalizing `account → post`).
- **Instagram** source working end to end via `@zweer/storynavigation-client`
  (account → posts; images, videos, carousels; Byparr/Cloudflare support). Keeps
  `instagram-archiver`'s on-disk layout exactly.
- **Pinterest** source present as a stub (interface implemented, `kind: 'query'`,
  returns an empty collection and logs a "not yet implemented" notice). The real
  scraping lands in Phase B.
- Orchestrator runs Instagram over its accounts and drives Pinterest with a
  seed-first BFS traversal honoring `depth`, `max_queries` (required) and
  in-memory per-run pin dedup. `depth=0` is a fail-fast config error.
- Storage supports both layouts: `instagram/<user>/<date>_<id>/` and
  `pinterest/<query-slug>/<pinid>/` plus per-query `query.yaml` and
  `related_searches.yaml` (always written). Atomic `.partial`-then-rename
  commit, zero-padded media filenames, `metadata.yaml` with a provider-supplied
  canonical URL.
- Discord summary grouped by source.
- `local/` Docker Compose + Makefile + `.env.example` + file-based lists
  mirroring `instagram-archiver/local`, adapted to the `SA_` env prefix.
- Low runtime footprint: `node:24-alpine`, prebuilt minified self-contained
  `dist/index.mjs`, plain `node` at runtime, one pass then exit.
