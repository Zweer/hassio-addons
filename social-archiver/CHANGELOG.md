# Changelog

## [0.1.1](https://github.com/Zweer/hassio-addons/compare/social-archiver-v0.1.0...social-archiver-v0.1.1) (2026-11-13)


### Features

* **social-archiver:** new multi-source archiver addon (Instagram + Pinterest) ([6f3d077](https://github.com/Zweer/hassio-addons/commit/6f3d077aeeab19ef12548c694d39e71b0031f650))


### Bug Fixes

* **social-archiver:** attach preview images to the summary instead of per-query threads ([6e1672d](https://github.com/Zweer/hassio-addons/commit/6e1672da06b71f4f7d9a2051e62740af02b3a5fd))
* **social-archiver:** make Pinterest scraping fill queries and survive flaky sessions ([889af45](https://github.com/Zweer/hassio-addons/commit/889af452e713c9087f44232b33b90e09aa8a6ae7))
* **social-archiver:** render Discord summary as bulleted lines ([abcb9e0](https://github.com/Zweer/hassio-addons/commit/abcb9e04f7ca33012066127d554f2b1ff36596c3))


### Performance

* **social-archiver:** share one Byparr session per run from the home page ([a51fb1e](https://github.com/Zweer/hassio-addons/commit/a51fb1e0f73a07efc97c05b7037a26b7364a1c1c))

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
