/**
 * Runtime configuration, read from environment variables that `run.sh`
 * populates from either the Hassio `options.json` or a local `.env`.
 */

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

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function parseInt10(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config: Config = {
    accounts: parseAccounts(env.IA_ACCOUNTS),
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

  return config;
}
