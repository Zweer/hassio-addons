/**
 * instagram-archive — entry point.
 *
 * Run-once flow:
 *   1. Launch a persistent (headful) Chromium context so cookies survive runs.
 *   2. Ensure we're logged in (reuse session cookie, else username/password).
 *   3. For each account, run a two-phase scrape:
 *        Phase 1 (new):      walk from the top until we hit the newest post we
 *                            already have; download everything above it.
 *        Phase 2 (backfill): if history isn't complete, fetch a bounded batch
 *                            of older posts starting from our oldest edge.
 *   4. Persist per-account state and exit.
 *
 * Challenges are surfaced via log + Discord and wait for a human on noVNC,
 * up to CHALLENGE_TIMEOUT seconds, then abort gracefully.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { chromium, type BrowserContext, type Page } from 'playwright-core';

import { loadConfig, type Config } from './config.js';
import { downloadPost, postExists } from './download.js';
import {
  ChallengeError,
  detectChallenge,
  fetchFeedPage,
  isLoggedIn,
  login,
  resolveUserId,
  waitForChallengeResolution,
  type Post,
} from './instagram.js';
import * as log from './notify.js';
import { loadState, saveState, type AccountState } from './state.js';
import { humanDelay, safeName } from './util.js';

const FEED_PAGE_SIZE = 12; // matches IG web app page size

/** Guard every feed fetch for a challenge that may appear mid-scrape. */
async function checkChallengeDuringScrape(page: Page, config: Config): Promise<void> {
  const reason = await detectChallenge(page);
  if (!reason) return;
  await log.notify(
    `⚠️ Challenge appeared during scraping (${reason}). Solve it via noVNC within ${config.challengeTimeout}s.`,
  );
  const solved = await waitForChallengeResolution(page, config.challengeTimeout);
  if (!solved) {
    throw new ChallengeError(`Challenge not resolved within ${config.challengeTimeout}s`);
  }
  await log.notify('✅ Challenge resolved, continuing.');
}

/**
 * Phase 1: download all posts newer than the newest we already have.
 *
 * Pinned-post safe: we compare by `taken_at` timestamp, never by list order,
 * because pinned posts appear at the top of the feed regardless of their date.
 * We keep paging until we've seen a full page whose posts are all older than
 * our known newest timestamp (plus a small page margin), rather than stopping
 * at the first already-seen post.
 *
 * Returns the number downloaded and the newest NON-pinned timestamp/shortcode
 * seen, used to advance the "newest" edge.
 */
async function scrapeNew(
  page: Page,
  config: Config,
  userId: string,
  accountDir: string,
  state: AccountState,
): Promise<{ downloaded: number; newestShortcode: string | null; newestTs: number }> {
  let downloaded = 0;
  let maxId: string | null = null;

  // The timestamp boundary of what we already have (0 = fresh account).
  const knownNewestTs = state.newestScrapedTimestamp
    ? Math.floor(new Date(state.newestScrapedTimestamp).getTime() / 1000)
    : 0;

  let newestShortcode: string | null = state.newestScrapedShortcode;
  let newestTs = knownNewestTs;

  // Fresh account (no prior newest edge): only take the first page of recent
  // posts here; the rest of the history is handled gradually by the backfill
  // phase to spread activity and reduce ban risk.
  const freshAccount = knownNewestTs === 0;

  // Safety: keep scanning a couple of pages past the boundary to be robust to
  // pinned posts sitting on top of the chronological stream.
  let pagesWithoutNew = 0;
  const MAX_EMPTY_PAGES = 2;

  while (true) {
    await checkChallengeDuringScrape(page, config);
    const feed = await fetchFeedPage(page, userId, FEED_PAGE_SIZE, maxId);
    if (feed.posts.length === 0) break;

    let newInThisPage = 0;

    for (const post of feed.posts) {
      // Track the newest edge from NON-pinned posts only.
      if (!post.pinned && post.takenAt > newestTs) {
        newestTs = post.takenAt;
        newestShortcode = post.shortcode;
      }

      const isNew = post.takenAt > knownNewestTs;
      // Skip posts we already have (older or equal to boundary), unless a
      // pinned old post we happen to be missing — download if not present.
      if (!isNew && !post.pinned) continue;

      if (await postExists(accountDir, post)) continue;

      try {
        if (await downloadPost(accountDir, post)) {
          downloaded += 1;
          if (isNew) newInThisPage += 1;
          log.info(`  [new${post.pinned ? '/pinned' : ''}] downloaded ${post.shortcode} (${post.images.length} img)`);
        }
      } catch {
        // download.ts already logged; continue
      }
      await humanDelay(config.randomizeDelay);
    }

    // On a fresh account, stop after the first page — backfill takes over.
    if (freshAccount) break;

    if (newInThisPage === 0) {
      pagesWithoutNew += 1;
      if (pagesWithoutNew >= MAX_EMPTY_PAGES) break;
    } else {
      pagesWithoutNew = 0;
    }

    if (!feed.moreAvailable || !feed.nextMaxId) break;
    maxId = feed.nextMaxId;
    await humanDelay(config.randomizeDelay, 1500, 3500);
  }

  return { downloaded, newestShortcode, newestTs };
}

/**
 * Phase 2: backfill a bounded batch of older posts.
 *
 * Pinned-post safe: we page to the end using the API's own `max_id` cursor
 * (chronological, unaffected by pinning) and only download posts strictly
 * OLDER than our current oldest timestamp. The oldest edge advances using the
 * minimum NON-pinned timestamp we download. `complete` is set when the API
 * reports no more pages.
 */
async function scrapeBackfill(
  page: Page,
  config: Config,
  userId: string,
  accountDir: string,
  state: AccountState,
): Promise<{ downloaded: number; oldestShortcode: string | null; oldestTs: number | null; complete: boolean }> {
  let downloaded = 0;
  let complete = false;

  const knownOldestTs = state.oldestScrapedTimestamp
    ? Math.floor(new Date(state.oldestScrapedTimestamp).getTime() / 1000)
    : Number.POSITIVE_INFINITY; // fresh account → everything is "older"

  let oldestShortcode: string | null = state.oldestScrapedShortcode;
  let oldestTs: number | null = Number.isFinite(knownOldestTs) ? knownOldestTs : null;

  let maxId: string | null = null;

  while (downloaded < config.backfillBatchSize) {
    await checkChallengeDuringScrape(page, config);
    const feed = await fetchFeedPage(page, userId, FEED_PAGE_SIZE, maxId);
    if (feed.posts.length === 0) {
      complete = true;
      break;
    }

    for (const post of feed.posts) {
      // Only backfill posts strictly older than our current oldest edge.
      // Pinned posts (which can appear anywhere) are ignored here to avoid
      // corrupting the oldest edge; they're handled by Phase 1.
      if (post.pinned) continue;
      if (post.takenAt >= knownOldestTs) continue;

      // Advance the oldest edge regardless of whether we (re)downloaded it.
      if (oldestTs === null || post.takenAt < oldestTs) {
        oldestTs = post.takenAt;
        oldestShortcode = post.shortcode;
      }

      if (await postExists(accountDir, post)) continue;

      try {
        if (await downloadPost(accountDir, post)) {
          downloaded += 1;
          log.info(`  [backfill] downloaded ${post.shortcode} (${post.images.length} img)`);
        }
      } catch {
        // continue
      }
      await humanDelay(config.randomizeDelay);

      if (downloaded >= config.backfillBatchSize) break;
    }

    if (!feed.moreAvailable || !feed.nextMaxId) {
      complete = true;
      break;
    }
    maxId = feed.nextMaxId;
    await humanDelay(config.randomizeDelay, 1500, 3500);
  }

  return { downloaded, oldestShortcode, oldestTs, complete };
}

async function processAccount(page: Page, config: Config, account: string): Promise<void> {
  const accountDir = path.join(config.outputDir, safeName(account));
  await fs.mkdir(accountDir, { recursive: true });

  const state = await loadState(accountDir, account);
  log.info(`Processing @${account} (backfillComplete=${state.backfillComplete})`);

  const { id: userId, isPrivate, postCount } = await resolveUserId(page, account);
  if (isPrivate) {
    log.warn(`@${account} is private — the logged-in account must follow it to see posts.`);
  }
  log.info(`  resolved @${account} → id=${userId}, ${postCount} posts on profile`);

  await humanDelay(config.randomizeDelay, 1500, 3000);

  // Phase 1 — new posts (timestamp-based, pinned-safe)
  const phase1 = await scrapeNew(page, config, userId, accountDir, state);
  if (phase1.newestShortcode && phase1.newestTs > 0) {
    state.newestScrapedShortcode = phase1.newestShortcode;
    state.newestScrapedTimestamp = new Date(phase1.newestTs * 1000).toISOString();
  }
  state.totalDownloaded += phase1.downloaded;

  // Phase 2 — backfill (only if history isn't complete)
  let backfillCount = 0;
  if (!state.backfillComplete) {
    const res = await scrapeBackfill(page, config, userId, accountDir, state);
    backfillCount = res.downloaded;
    state.totalDownloaded += backfillCount;
    if (res.oldestShortcode && res.oldestTs !== null) {
      state.oldestScrapedShortcode = res.oldestShortcode;
      state.oldestScrapedTimestamp = new Date(res.oldestTs * 1000).toISOString();
    }
    if (res.complete) {
      state.backfillComplete = true;
      log.info(`  backfill complete for @${account}`);
    }
  }

  state.lastRun = new Date().toISOString();
  await saveState(accountDir, state);

  log.info(`  @${account}: +${phase1.downloaded} new, +${backfillCount} backfill (total ${state.totalDownloaded})`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  log.initNotifier(config.discordWebhook);

  log.info(`Starting run for ${config.accounts.length} account(s): ${config.accounts.join(', ')}`);

  const profileDir = path.join(config.dataDir, 'chromium-profile');
  await fs.mkdir(profileDir, { recursive: true });

  const context: BrowserContext = await chromium.launchPersistentContext(profileDir, {
    headless: false, // headful so challenges are solvable via noVNC
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
    ],
  });

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(60000);

  let exitCode = 0;
  try {
    if (!(await isLoggedIn(page))) {
      log.info('No valid session — logging in.');
      await login(page, config.igUsername, config.igPassword, config.challengeTimeout);
    } else {
      log.info('Reusing existing session.');
    }

    for (const account of config.accounts) {
      try {
        await processAccount(page, config, account);
      } catch (err) {
        if (err instanceof ChallengeError) {
          await log.notify(`❌ Aborting: ${err.message}`);
          exitCode = 2;
          break;
        }
        log.error(`Error processing @${account}: ${(err as Error).message}`);
        // continue with next account
      }
      await humanDelay(config.randomizeDelay, 3000, 6000);
    }

    if (exitCode === 0) {
      await log.notify(`✅ Run complete for ${config.accounts.length} account(s).`);
    }
  } catch (err) {
    log.error(`Fatal: ${(err as Error).message}`);
    await log.notify(`❌ Run failed: ${(err as Error).message}`);
    exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
