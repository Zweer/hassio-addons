# Changelog

## [1.2.0](https://github.com/Zweer/hassio-addons/compare/instagram-archiver-v1.1.0...instagram-archiver-v1.2.0) (2026-10-23)


### Features

* **instagram-archiver:** :sparkles: support Cloudflare solver + add local self-hosted compose ([b531937](https://github.com/Zweer/hassio-addons/commit/b531937dcfee6bcc1a9d1b7272c61622baefcb25))


### Bug Fixes

* **instagram-archiver:** bump storynavigation-client to 1.1.1 to fix expired image URLs ([8ebeb34](https://github.com/Zweer/hassio-addons/commit/8ebeb34f43352f1748eba476853aedb734a6c58d))
* **instagram-archiver:** make local setup robust to slow Byparr cold-start ([bb81561](https://github.com/Zweer/hassio-addons/commit/bb8156172fb5a9ebd44ce79cf69842bd93d9076f))

## [1.1.0](https://github.com/Zweer/hassio-addons/compare/instagram-archiver-v1.0.0...instagram-archiver-v1.1.0) (2026-09-23)


### Features

* **instagram-archiver:** add addon icon and logo ([13d78dd](https://github.com/Zweer/hassio-addons/commit/13d78dda5405e7d27fb204cfcc4dd4bb0fba7064))

## 1.0.0 (2026-09-23)


### Features

* **instagram-archiver:** add addon to archive public IG profiles ([4ae9cfd](https://github.com/Zweer/hassio-addons/commit/4ae9cfda827bac8e5092fd957e76b4e7c061e46d))

## 0.1.0

- Initial release.
- Archives the latest ~12 posts (images, videos, carousels) from public
  Instagram profiles via StoryNavigation (`@zweer/storynavigation-client`).
- Organizes output as `/share/instagram/<username>/<date>_<postid>/` with
  zero-padded media files and a `metadata.yaml` (caption + post metadata).
- Filesystem-based dedup (already-archived posts are skipped) with atomic
  commit via temp-folder rename.
- Optional Discord webhook summary: terse message on bootstrap; summary +
  per-account preview thread on daily runs.
- Source-agnostic `IngestProvider` design + a planned `POST /ingest` endpoint
  so a future browser-userscript backfill can plug in unchanged.
