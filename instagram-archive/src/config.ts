/**
 * Configuration loaded from environment variables.
 * run.sh translates HA options.json (or local .env) into these env vars.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export interface Config {
  /** Instagram accounts (handles, without @) to archive. */
  accounts: string[];
  /** Login credentials — used only when no valid session cookie exists. */
  igUsername: string;
  igPassword: string;
  /** Optional Discord webhook for notifications. */
  discordWebhook: string;
  /** Seconds to wait for a human to solve a challenge via noVNC before giving up. */
  challengeTimeout: number;
  /** Max number of historical (backfill) posts to fetch per account per run. */
  backfillBatchSize: number;
  /** Randomize delays between actions to look more human / avoid bans. */
  randomizeDelay: boolean;
  /** Root output directory (HA /share). */
  outputDir: string;
  /** Persistent state/session directory (HA /data). */
  dataDir: string;
}

export function loadConfig(): Config {
  const accountsRaw = optional('IG_ACCOUNTS');
  const accounts = accountsRaw
    .split(/[\s,]+/)
    .map((a) => a.replace(/^@/, '').trim())
    .filter((a) => a.length > 0);

  if (accounts.length === 0) {
    throw new Error('No accounts configured — set at least one account in IG_ACCOUNTS');
  }

  return {
    accounts,
    igUsername: required('IG_USERNAME'),
    igPassword: required('IG_PASSWORD'),
    discordWebhook: optional('DISCORD_WEBHOOK'),
    challengeTimeout: intEnv('CHALLENGE_TIMEOUT', 180),
    backfillBatchSize: intEnv('BACKFILL_BATCH_SIZE', 30),
    randomizeDelay: boolEnv('RANDOMIZE_DELAY', true),
    outputDir: optional('OUTPUT_DIR', '/share/instagram'),
    dataDir: optional('DATA_DIR', '/data'),
  };
}
