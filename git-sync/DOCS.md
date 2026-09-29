# Git Sync

One-shot, **bidirectional** Git sync for your Home Assistant config, with two
authentication methods: an **SSH deploy key** or an **HTTPS Personal Access
Token (PAT)**. Pick one with the `auth_method` option.

When started, the addon does **one** reconcile of `/config` with a Git remote
and then **exits** — there is no always-on process and no web server. Home
Assistant automations start it on demand (schedule, button, event) via the
Supervisor API.

## How it works

Order per run: **PULL first, then PUSH.**

1. **PULL** — `git fetch` + `git pull --ff-only` in the checkout, then the
   pulled state is mirrored into `/config`.
2. **PUSH** — `/config` is mirrored back into the checkout, changes are
   committed and `git push`-ed **without force**.

The Git checkout lives in `/data/gitrepo`, **separate** from `/config`, so the
addon never creates a nested `/config/config` checkout.

### Fail-safe model (important)

The addon **never merges and never force-pushes**. On any conflict it stops
immediately, touches nothing, logs the reason, records `state: conflict` in the
status file, and exits non-zero:

- **`git pull --ff-only` fails** (local checkout diverged) →
  `CONFLICT: local checkout diverged, manual intervention needed`.
- **`git push` is rejected** (remote advanced) →
  `CONFLICT: remote ahead, pull needed`.

When this happens, resolve it manually on a workstation (clone the repo, sort
out the divergence, push), then start the addon again.

## What is synced (and what is not)

These paths are excluded (both in the checkout `.gitignore` and from the rsync),
because they are host-/runtime-specific or secret:

`secrets.yaml`* · `.storage/` · `home-assistant_v2.db*` · `*.log` · `.cache/` ·
`custom_components/` (HACS) · `deps/` · `tts/` · `.cloud/` · `backups/` · `.git/`

> \* `secrets.yaml` is special-cased: an **emptied placeholder** is committed so
> its existence is tracked, but your real secret values are **never** pushed.

Add more patterns with the `extra_excludes` option.

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `repository` | Remote URL. SSH: `git@github.com:user/ha-config.git`. PAT: `https://github.com/user/ha-config.git` | — |
| `branch` | Branch to sync | `main` |
| `auth_method` | `ssh` (deploy key) or `pat` (HTTPS token) | `ssh` |
| `deploy_key` | Private SSH deploy key (multiline) — used when `auth_method: ssh` | — |
| `pat_token` | Personal Access Token with write access — used when `auth_method: pat` | — |
| `dry_run` | Simulate a full reconcile without writing anything (see below) | `false` |
| `extra_excludes` | Extra rsync/`.gitignore` patterns (list) | `[]` |

### Dry run — validate the first run safely

Because rsync-to-`/config`, the SSH deploy key, and the `config` map only exist
**inside** the HA container, the addon can only be truly exercised on the HA
machine. `dry_run` lets you do that with **zero risk** on your **real** config:

- both rsync passes run with `--dry-run --itemize-changes` (they print what they
  *would* copy/delete and touch nothing),
- the `--ff-only` pull is checked (would it fast-forward or diverge?) but the
  checkout is **not** advanced,
- `git add` / `commit` / `push` are **skipped entirely**,
- the run still writes `state: dry-run` to the status file and exits `0`.

Recommended first-run flow:

1. Install the addon, set `repository` + `deploy_key`, set **`dry_run: true`**.
2. Start it, open the log. Read the itemized rsync output — in particular any
   line starting with `*deleting` under `checkout -> /config`, which would be a
   file removed from your live config.
3. When the log looks correct, set `dry_run: false` and start it again for the
   real sync.

### Authentication — option A: SSH deploy key (`auth_method: ssh`)

Use an **SSH** repository URL (`git@github.com:user/ha-config.git`).

#### Generating the SSH deploy key (do this ON the HA host, not in chat)

Open the HA host terminal (e.g. the *Terminal & SSH* / *Advanced SSH* addon) and
run:

```sh
ssh-keygen -t ed25519 -C "ha-git-sync" -f /root/.ssh/ha_git_sync -N ""
cat /root/.ssh/ha_git_sync        # <-- PRIVATE key: paste into deploy_key
cat /root/.ssh/ha_git_sync.pub    # <-- PUBLIC key: add to GitHub (below)
```

Never send a private key through chat or a shared channel. Generate it on the
machine that will use it and paste only into the addon's `deploy_key` field.

#### Adding the deploy key to the GitHub repo

1. GitHub → your config repo → **Settings → Deploy keys → Add deploy key**.
2. Paste the **public** key (`.pub`).
3. Tick **Allow write access** (the addon needs to push).

### Authentication — option B: HTTPS Personal Access Token (`auth_method: pat`)

Use an **HTTPS** repository URL (`https://github.com/user/ha-config.git`), set
`auth_method: pat`, and paste a token into `pat_token`. No SSH key is needed.

On **GitHub**, prefer a **fine-grained** token scoped to just this repo:

1. GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Repository access:** *Only select repositories* → your config repo.
3. **Permissions → Repository permissions → Contents:** *Read and write*.
   (That single permission is enough to clone, pull and push.)
4. Set an expiry and generate. Copy the token and paste it into `pat_token`.

A classic token with the `repo` scope also works. On GitLab, use a project or
personal access token with the `write_repository` scope.

The token is handed to git through an askpass helper, so it is **never written
into the remote URL, `.git/config`, or the addon logs**. Rotate it by pasting a
new one; revoke the old one from the provider.

## Status file

Every run writes `/config/.gitsync_status.json`:

```json
{
  "state": "ok",
  "action": "sync",
  "last_run": "2026-09-28T16:00:00Z",
  "last_commit": "abc1234...",
  "message": "sync complete",
  "ahead": 0,
  "behind": 0
}
```

`state` is one of `ok`, `conflict`, `error`, `dry-run`. See
[`examples/ha-config.yaml`](examples/ha-config.yaml) for file/command_line
sensors that surface this in HA, a `rest_command` that starts the addon via the
Supervisor API, and automations that sync on a schedule and notify on conflict.

## Starting the addon from an automation

The addon slug as seen by the Supervisor is `local_git_sync` (local repository
addons are prefixed `local_`). Start it with a single Supervisor API call:

```yaml
rest_command:
  git_sync_run:
    url: "http://supervisor/addons/local_git_sync/start"
    method: POST
    headers:
      authorization: "Bearer {{ states('sensor.git_sync_token') }}"
```

Home Assistant injects the Supervisor token into add-ons as `SUPERVISOR_TOKEN`;
from an automation the simplest supported path is the `hassio.addon_start`
action (no token handling needed):

```yaml
- action: hassio.addon_start
  data:
    addon: local_git_sync
```

See the examples file for both approaches.

## Logs

Logs are visible in the Home Assistant addon log panel, each line prefixed
`[git-sync]`. A run exits `0` on success and non-zero on conflict/error.

## Credits

The addon icon uses the official [Git logo](https://git-scm.com/downloads/logos)
by Jason Long, licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
