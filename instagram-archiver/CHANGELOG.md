# Changelog

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
