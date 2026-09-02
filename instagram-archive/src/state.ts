/**
 * Per-account persistent state, stored as `_state.json` inside each account folder.
 * The folders themselves are the source of truth for anti-duplication; this file
 * is an index of the "edges" already scraped so we don't re-scroll the whole
 * profile on every run.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface AccountState {
  account: string;
  /** True once we've scrolled all the way to the oldest post of the profile. */
  backfillComplete: boolean;
  /** Oldest post we've archived (bottom edge of what we have). */
  oldestScrapedShortcode: string | null;
  oldestScrapedTimestamp: string | null;
  /** Newest post we've archived (top edge of what we have). */
  newestScrapedShortcode: string | null;
  newestScrapedTimestamp: string | null;
  lastRun: string | null;
  totalDownloaded: number;
}

function emptyState(account: string): AccountState {
  return {
    account,
    backfillComplete: false,
    oldestScrapedShortcode: null,
    oldestScrapedTimestamp: null,
    newestScrapedShortcode: null,
    newestScrapedTimestamp: null,
    lastRun: null,
    totalDownloaded: 0,
  };
}

function statePath(accountDir: string): string {
  return path.join(accountDir, '_state.json');
}

export async function loadState(accountDir: string, account: string): Promise<AccountState> {
  try {
    const raw = await fs.readFile(statePath(accountDir), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AccountState>;
    return { ...emptyState(account), ...parsed, account };
  } catch {
    return emptyState(account);
  }
}

export async function saveState(accountDir: string, state: AccountState): Promise<void> {
  await fs.mkdir(accountDir, { recursive: true });
  await fs.writeFile(statePath(accountDir), JSON.stringify(state, null, 2), 'utf-8');
}
