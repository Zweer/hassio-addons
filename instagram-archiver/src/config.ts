/**
 * Runtime configuration, read from environment variables that `run.sh`
 * populates from either the Hassio `options.json` or a local `.env`.
 */

import { readFileSync } from 'node:fs';

export interface Config {
  /** Public Instagram usernames to archive. */
  accounts: string[];
  /** Optional Discord webhook for summaries. */
  discordWebhookUrl?: string;
  /** Delay between requests/downloads, to be gentle on the source (ms). */
  requestDelayMs: number;
  /** Send a Discord message even when nothing new was found. */
  notifyEmpty: boolean;
  /** Root output directory for the archive. */
  outputDir: string;
  /** Max bytes for a single media download (undefined → client default). */
  maxDownloadBytes?: number;
  /**
   * Byparr (FlareSolverr-compatible) base URL used to clear StoryNavigation's
   * Cloudflare challenge. Optional, no default — unset preserves the library's
   * fail-fast behaviour when a challenge is hit without a solver.
   */
  byparrUrl?: string;
}

function parseAccounts(raw: string | undefined): string[] {
  if (!raw) return [];
  // Hassio passes a JSON array string; local .env may pass CSV.
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x).trim()).filter(Boolean);
      }
    } catch {
      // fall through to CSV parsing
    }
  }
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Parse an accounts file (one username per line). Strips from the first `#`
 * comment marker, trims, and drops blank lines — same discipline as `run.sh`'s
 * local `.env` reader.
 */
function parseAccountsFile(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.split('#')[0].trim())
    .filter(Boolean);
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function parseInt10(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve the accounts list. `IA_ACCOUNTS_FILE` (used only by `local/`) wins
 * over `IA_ACCOUNTS` when it is set, readable, and non-empty; any read error or
 * empty result warns and falls back to `IA_ACCOUNTS`. When unset, this behaves
 * identically to `parseAccounts(IA_ACCOUNTS)`.
 */
function resolveAccounts(env: NodeJS.ProcessEnv): string[] {
  const filePath = env.IA_ACCOUNTS_FILE?.trim();
  if (filePath) {
    try {
      const fromFile = parseAccountsFile(readFileSync(filePath, 'utf8'));
      if (fromFile.length > 0) return fromFile;
      console.warn(
        `[instagram-archiver] IA_ACCOUNTS_FILE (${filePath}) had no usable accounts — falling back to IA_ACCOUNTS.`,
      );
    } catch (err) {
      console.warn(
        `[instagram-archiver] Could not read IA_ACCOUNTS_FILE (${filePath}): ${err instanceof Error ? err.message : String(err)} — falling back to IA_ACCOUNTS.`,
      );
    }
  }
  return parseAccounts(env.IA_ACCOUNTS);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config: Config = {
    accounts: resolveAccounts(env),
    requestDelayMs: parseInt10(env.IA_REQUEST_DELAY_MS, 1500),
    notifyEmpty: parseBool(env.IA_NOTIFY_EMPTY, false),
    outputDir: (env.IA_OUTPUT_DIR ?? '/share/instagram').trim(),
  };

  const webhook = env.IA_DISCORD_WEBHOOK_URL?.trim();
  if (webhook) config.discordWebhookUrl = webhook;

  const maxMb = env.IA_MAX_DOWNLOAD_MB?.trim();
  if (maxMb) {
    const n = Number.parseInt(maxMb, 10);
    if (Number.isFinite(n) && n > 0) config.maxDownloadBytes = n * 1024 * 1024;
  }

  const byparr = env.IA_BYPARR_URL?.trim();
  if (byparr) config.byparrUrl = byparr;

  return config;
}
