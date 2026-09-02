# Instagram Archive

Daily archiver for Instagram **feed posts** of the accounts you choose. It drives
a real (headful) Chromium browser inside the addon, logs in with an Instagram
account, and downloads posts into a folder tree on `/share`. When Instagram shows
a login challenge, you solve it live through an in-browser **noVNC** session
exposed via Home Assistant ingress.

> ⚠️ **Use a throwaway Instagram account, never your main one.** Automated
> scraping violates Instagram's Terms of Service and can get the account
> challenged, shadowbanned, or permanently banned. Keep volumes low.

## How it works

The addon runs **once per start** and then exits:

1. Starts a virtual display (Xvfb) + VNC + noVNC so challenges can be solved.
2. Launches Chromium with a **persistent profile** in `/data` — the login
   session survives between runs, so you normally log in only once.
3. For each account, it runs a **two-phase scrape**:
   - **Phase 1 — new posts:** walks the profile from the top and downloads
     everything newer than the most recent post already archived.
   - **Phase 2 — backfill:** downloads a bounded batch of older posts
     (`backfill_batch_size`) until the whole history has been archived. This
     spreads the historical download over several runs to reduce ban risk.
4. Saves per-account state and exits.

Because the addon exits after each run, you schedule it from Home Assistant
(see [Scheduling](#scheduling)).

## Output layout

Everything goes under `/share/instagram`:

```
/share/instagram/
├── account_uno/
│   ├── _state.json
│   ├── 2026-09-02_CxYz123/
│   │   ├── 01.jpg
│   │   ├── 02.jpg          # carousel / multi-photo posts
│   │   └── caption.txt     # shortcode, url, date, caption text
│   └── 2026-09-01_DaBc456/
│       └── 01.jpg
└── account_due/
    └── ...
```

A post is considered "already downloaded" if its folder exists — no database
needed. `_state.json` just records the oldest/newest posts archived so runs
don't re-scroll the entire profile.

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `accounts` | List of Instagram handles to archive (without `@`) | — |
| `ig_username` | Instagram login username (throwaway account) | — |
| `ig_password` | Instagram login password | — |
| `discord_webhook` | Discord webhook URL for notifications (optional) | — |
| `challenge_timeout` | Seconds to wait for you to solve a challenge via noVNC before aborting | `180` |
| `backfill_batch_size` | Max historical posts to fetch per account per run | `30` |
| `randomize_delay` | Randomize delays between actions to look more human | `true` |
| `novnc_password` | Optional password for the noVNC session (extra layer on top of HA ingress auth) | — |

Example:

```yaml
accounts:
  - nasa
  - natgeo
ig_username: my_throwaway_account
ig_password: "••••••••"
discord_webhook: https://discord.com/api/webhooks/...
challenge_timeout: 180
backfill_batch_size: 30
randomize_delay: true
# novnc_password: "optional-extra-password"
```

## First run & challenges

On the **first run** the addon has no session, so it logs in with your
credentials. Instagram often shows a verification challenge on a new login from
a datacenter/home IP. When that happens:

1. The addon logs it and (if configured) sends a **Discord notification**.
2. Open the addon from the Home Assistant sidebar — you'll see the **live
   browser (noVNC)**.
3. Solve the challenge (enter the code, confirm it's you, etc.).
4. The addon detects the challenge is gone and continues automatically.

If nobody solves it within `challenge_timeout` seconds, the addon saves its
state and exits; it will retry on the next run. After a successful first login,
the session cookie is reused and challenges become rare.

## Scheduling

The addon is **run-once** (`boot: manual`), so trigger it from a Home Assistant
automation. Example — run every day at 03:00:

```yaml
alias: Instagram Archive daily
triggers:
  - trigger: time
    at: "03:00:00"
actions:
  - action: hassio.addon_start
    data:
      addon: local_instagram-archive   # slug may differ; check your install
mode: single
```

You can also trigger it manually from the addon page, or from any other
automation/event.

## Notes & limitations

- **Feed posts only** — no stories, no reels, no tagged posts.
- **Pinned posts** are handled correctly: the scraper compares posts by their
  real timestamp (`taken_at`), not by their position in the feed, so pinned
  posts at the top of a profile don't stop the scan or corrupt the "how far
  I've got" bookmarks. Pinned posts are still downloaded.
- **Private accounts**: the logged-in account must follow them to see posts.
- Instagram changes its internal endpoints over time; if scraping stops
  working, the addon may need an update.
- Running a browser on a Raspberry Pi 4 is heavy. Keep the account list and
  `backfill_batch_size` modest.

## Logs

Logs appear in the Home Assistant addon log panel. If `discord_webhook` is set,
key events (challenges, run completion, failures) are also sent to Discord.
