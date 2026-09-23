# Changelog

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
