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
 * Returns the number downloaded and the newest post seen (to update state).
 */
async function scrapeNew(
  page: Page,
  config: Config,
  userId: string,
  accountDir: string,
  state: AccountState,
): Promise<{ downloaded: number; newest: Post | null }> {
  let downloaded = 0;
  let newest: Post | null = null;
  let maxId: string | null = null;
  let reachedKnown = false;

  while (!reachedKnown) {
    await checkChallengeDuringScrape(page, config);
    const feed = await fetchFeedPage(page, userId, FEED_PAGE_SIZE, maxId);
    if (feed.posts.length === 0) break;

    for (const post of feed.posts) {
      if (!newest) newest = post; // first post is the newest overall

      // Stop as soon as we reach a post we already archived.
      if (
        (state.newestScrapedShortcode && post.shortcode === state.newestScrapedShortcode) ||
        (await postExists(accountDir, post))
      ) {
        reachedKnown = true;
        break;
      }

      try {
        if (await downloadPost(accountDir, post)) {
          downloaded += 1;
          log.info(`  [new] downloaded ${post.shortcode} (${post.images.length} img)`);
        }
      } catch {
        // download.ts already logged; continue with next post
      }
      await humanDelay(config.randomizeDelay);
    }

    if (reachedKnown || !feed.moreAvailable || !feed.nextMaxId) break;
    maxId = feed.nextMaxId;
    await humanDelay(config.randomizeDelay, 1500, 3500);
  }

  return { downloaded, newest };
}

/**
 * Phase 2: backfill a bounded batch of older posts, starting from our oldest
 * edge. Updates state's oldest edge and sets backfillComplete when we reach
 * the end of the profile.
 */
async function scrapeBackfill(
  page: Page,
  config: Config,
  userId: string,
  accountDir: string,
  state: AccountState,
): Promise<{ downloaded: number; oldest: Post | null; complete: boolean }> {
  let downloaded = 0;
  let oldest: Post | null = null;
  let complete = false;

  // Walk from the top until we pass our known oldest post, then start
  // downloading older ones up to the batch size.
  let maxId: string | null = null;
  let passedOldest = state.oldestScrapedShortcode === null; // if no edge yet, start immediately

  while (downloaded < config.backfillBatchSize) {
    await checkChallengeDuringScrape(page, config);
    const feed = await fetchFeedPage(page, userId, FEED_PAGE_SIZE, maxId);
    if (feed.posts.length === 0) {
      complete = true;
      break;
    }

    for (const post of feed.posts) {
      if (!passedOldest) {
        // Skip forward until we cross our current oldest edge.
        if (post.shortcode === state.oldestScrapedShortcode) {
          passedOldest = true;
        }
        continue;
      }

      // Now we're in "older than what we have" territory.
      try {
        if (await downloadPost(accountDir, post)) {
          downloaded += 1;
          oldest = post; // keep advancing the oldest edge
          log.info(`  [backfill] downloaded ${post.shortcode} (${post.images.length} img)`);
        } else {
          // already exists — still advance the edge
          oldest = post;
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

  return { downloaded, oldest, complete };
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

  // Phase 1 — new posts
  const { downloaded: newCount, newest } = await scrapeNew(page, config, userId, accountDir, state);
  if (newest) {
    state.newestScrapedShortcode = newest.shortcode;
    state.newestScrapedTimestamp = new Date(newest.takenAt * 1000).toISOString();
  }
  state.totalDownloaded += newCount;

  // On a fresh account (no oldest edge yet), the newest post becomes the top
  // of our archive; backfill then walks downward from there.
  if (!state.oldestScrapedShortcode && newest) {
    state.oldestScrapedShortcode = newest.shortcode;
    state.oldestScrapedTimestamp = state.newestScrapedTimestamp;
  }

  // Phase 2 — backfill (only if history isn't complete)
  let backfillCount = 0;
  if (!state.backfillComplete) {
    const res = await scrapeBackfill(page, config, userId, accountDir, state);
    backfillCount = res.downloaded;
    state.totalDownloaded += backfillCount;
    if (res.oldest) {
      state.oldestScrapedShortcode = res.oldest.shortcode;
      state.oldestScrapedTimestamp = new Date(res.oldest.takenAt * 1000).toISOString();
    }
    if (res.complete) {
      state.backfillComplete = true;
      log.info(`  backfill complete for @${account}`);
    }
  }

  state.lastRun = new Date().toISOString();
  await saveState(accountDir, state);

  log.info(`  @${account}: +${newCount} new, +${backfillCount} backfill (total ${state.totalDownloaded})`);
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
