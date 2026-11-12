/**
 * Runtime configuration for the multi-source archiver, read from environment
 * variables that `run.sh` populates from either the Hassio `options.json` or a
 * local `.env`. Uses the `SA_` (social-archiver) prefix throughout.
 */

import { readFileSync } from 'node:fs';

/** Instagram source: a list of public usernames. */
export interface InstagramConfig {
  accounts: string[];
}

/** Pinterest source: seed queries + traversal controls. */
export interface PinterestConfig {
  /** Seed search queries (the `depth=1` set). */
  queries: string[];
  /**
   * Number of levels to include (1-based). 1 → only the seed queries; 2 →
   * seeds + one level of related; etc. 0 is an ERROR (fail fast at startup).
   */
  depth: number;
  /** Max pins to archive per query. */
  maxImages: number;
  /** Hard cap on the total number of queries visited in a run (required). */
  maxQueries: number;
}

export interface Config {
  instagram: InstagramConfig;
  pinterest: PinterestConfig;
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
   * Byparr (FlareSolverr-compatible) base URL used to clear Cloudflare
   * challenges (StoryNavigation + Pinterest). Optional, no default.
   */
  byparrUrl?: string;
  /**
   * Max time (ms) Byparr may spend on a single solve, sent as `maxTimeout`.
   * Optional, no default — unset preserves client defaults. Raise it for a slow
   * cold-start solve (the stealth browser can take 2-3 min under load).
   */
  byparrTimeoutMs?: number;
}

/** Thrown when the config is invalid; the orchestrator fails fast on this. */
export class ConfigError extends Error {}

/**
 * Parse a list that may arrive as a JSON array string (Hassio) or CSV (local
 * .env). Trims and drops blanks.
 */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
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
 * Parse a list file (one entry per line). Strips from the first `#` comment
 * marker, trims, and drops blank lines — same discipline as `run.sh`'s local
 * `.env` reader and instagram-archiver's accounts file.
 */
function parseListFile(raw: string): string[] {
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
 * Resolve a list from an optional file env var (wins when set, readable and
 * non-empty) falling back to an inline env var. Mirrors instagram-archiver's
 * IA_ACCOUNTS_FILE behaviour.
 */
function resolveList(
  env: NodeJS.ProcessEnv,
  fileVar: string,
  inlineVar: string,
): string[] {
  const filePath = env[fileVar]?.trim();
  if (filePath) {
    try {
      const fromFile = parseListFile(readFileSync(filePath, 'utf8'));
      if (fromFile.length > 0) return fromFile;
      console.warn(
        `[social-archiver] ${fileVar} (${filePath}) had no usable entries — falling back to ${inlineVar}.`,
      );
    } catch (err) {
      console.warn(
        `[social-archiver] Could not read ${fileVar} (${filePath}): ${err instanceof Error ? err.message : String(err)} — falling back to ${inlineVar}.`,
      );
    }
  }
  return parseList(env[inlineVar]);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const accounts = resolveList(env, 'SA_INSTAGRAM_ACCOUNTS_FILE', 'SA_INSTAGRAM_ACCOUNTS');
  const queries = resolveList(env, 'SA_PINTEREST_QUERIES_FILE', 'SA_PINTEREST_QUERIES');

  const depth = parseInt10(env.SA_PINTEREST_DEPTH, 1);
  // depth=0 is NOT "unlimited" — it is a configuration error. Fail fast.
  if (depth === 0) {
    throw new ConfigError(
      'SA_PINTEREST_DEPTH=0 is invalid. Use 1 for seed queries only, 2 to follow related once, etc. (0 does NOT mean unlimited).',
    );
  }
  if (depth < 0) {
    throw new ConfigError(`SA_PINTEREST_DEPTH must be >= 1 (got ${depth}).`);
  }

  // max_queries is the required hard safety cap on total queries visited.
  const rawMaxQueries = env.SA_PINTEREST_MAX_QUERIES?.trim();
  if (queries.length > 0 && (rawMaxQueries === undefined || rawMaxQueries === '')) {
    throw new ConfigError(
      'SA_PINTEREST_MAX_QUERIES is required when Pinterest queries are configured (hard cap on total queries visited per run).',
    );
  }
  const maxQueries = parseInt10(rawMaxQueries, 0);
  if (queries.length > 0 && maxQueries < 1) {
    throw new ConfigError(`SA_PINTEREST_MAX_QUERIES must be >= 1 (got ${maxQueries}).`);
  }

  const config: Config = {
    instagram: { accounts },
    pinterest: {
      queries,
      depth,
      maxImages: parseInt10(env.SA_PINTEREST_MAX_IMAGES, 50),
      maxQueries,
    },
    requestDelayMs: parseInt10(env.SA_REQUEST_DELAY_MS, 1500),
    notifyEmpty: parseBool(env.SA_NOTIFY_EMPTY, false),
    outputDir: (env.SA_OUTPUT_DIR ?? '/share/social-archiver').trim(),
  };

  const webhook = env.SA_DISCORD_WEBHOOK_URL?.trim();
  if (webhook) config.discordWebhookUrl = webhook;

  const maxMb = env.SA_MAX_DOWNLOAD_MB?.trim();
  if (maxMb) {
    const n = Number.parseInt(maxMb, 10);
    if (Number.isFinite(n) && n > 0) config.maxDownloadBytes = n * 1024 * 1024;
  }

  const byparr = env.SA_BYPARR_URL?.trim();
  if (byparr) config.byparrUrl = byparr;

  const byparrTimeout = env.SA_BYPARR_TIMEOUT_MS?.trim();
  if (byparrTimeout) {
    const n = Number.parseInt(byparrTimeout, 10);
    if (Number.isFinite(n) && n > 0) config.byparrTimeoutMs = n;
  }

  return config;
}
