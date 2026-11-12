# Social Archiver — Documentation

This addon archives public content from multiple social sources into `/share`.
It runs **one pass per invocation** and exits — schedule it from a Home
Assistant automation (e.g. once a day).

> The primary real-world usage is the `local/` Docker Compose flow on a PC, not
> the Home Assistant runtime. See [`local/README.md`](local/README.md).

## Installation (Home Assistant)

1. Add this repository to the Supervisor add-on store.
2. Install **Social Archiver**.
3. Configure the options (below) and point `byparr_url` at a reachable
   [Byparr](https://github.com/ThePhaseless/Byparr) instance.
4. Start the add-on from an automation on your schedule.

## Options

```yaml
instagram:
  accounts:
    - nasa
    - natgeo
pinterest:
  queries:
    - "boardroom outfit women 2026"
    - "minimalist living room"
  depth: 2            # 1 = seeds only; 2 = seeds + related; 0 = ERROR
  max_images: 50      # pins archived per query
  max_queries: 20     # REQUIRED total cap on queries visited this run
request_delay_ms: 1500
notify_empty: false
discord_webhook_url: "https://discord.com/api/webhooks/…"
output_dir: "/share/social-archiver"
max_download_mb: 50
byparr_url: "http://byparr:8191"
byparr_timeout_ms: 180000
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `instagram.accounts` | list of str | `[]` | Public Instagram usernames. |
| `pinterest.queries` | list of str | `[]` | Seed Pinterest search queries. |
| `pinterest.depth` | int ≥ 1 | `1` | Levels to include (1-based). `0` fails fast. |
| `pinterest.max_images` | int | `50` | Pins archived per query. |
| `pinterest.max_queries` | int ≥ 1 | — | **Required** when queries are set. Total cap. |
| `request_delay_ms` | int | `1500` | Delay between requests/downloads. |
| `notify_empty` | bool | `false` | Discord message even with nothing new. |
| `discord_webhook_url` | url | — | Optional run-summary webhook. |
| `output_dir` | str | `/share/social-archiver` | Archive root. |
| `max_download_mb` | int | — | Per-file download cap (MB). |
| `byparr_url` | url | — | FlareSolverr-compatible solver base URL. |
| `byparr_timeout_ms` | int | — | Max ms per solve; raise for slow cold start. |

## Output

See the layout and traversal semantics in the main
[README](README.md#storage-layout). In short: Instagram uses a per-post layout;
Pinterest gets a per-query bucket with `query.yaml`, `related_searches.yaml`,
and one folder per pin.

## Sources

- **Instagram:** public profiles via the StoryNavigation mirror (latest ~12
  posts per profile), behind a Byparr session.
- **Pinterest:** search queries via the internal
  `/resource/BaseSearchResource/get/` JSON endpoint behind a Byparr session,
  following related searches breadth-first up to the configured `depth`.
