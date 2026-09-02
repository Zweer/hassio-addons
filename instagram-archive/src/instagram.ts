/**
 * Instagram interaction layer.
 *
 * Strategy: drive a real (headful) Chromium session for login + challenge
 * handling, then call Instagram's own internal JSON endpoints from inside the
 * authenticated page. This is far more stable than scraping the React DOM.
 *
 *  - `web_profile_info`        → resolve a username to a numeric user id
 *  - `/api/v1/feed/user/{id}/` → paginate a user's timeline (stable `max_id`
 *                                cursor, unlike the churny GraphQL `doc_id`)
 *
 * All API calls run via page.evaluate so they carry the session cookies and
 * the `x-ig-app-id` header, exactly as the web app does.
 */

import type { BrowserContext, Page } from 'playwright-core';

import * as log from './notify.js';
import { humanDelay, sleep } from './util.js';

const IG_APP_ID = '936619743392459'; // public web app id
const BASE = 'https://www.instagram.com';

export interface MediaImage {
  url: string;
  width: number;
  height: number;
}

/** A single archivable post (may contain multiple images / carousel). */
export interface Post {
  shortcode: string;
  /** Post creation time (unix seconds). */
  takenAt: number;
  caption: string;
  /** One entry per image. Videos are represented by their thumbnail. */
  images: MediaImage[];
}

/** Thrown when a challenge/checkpoint is detected and not resolved in time. */
export class ChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallengeError';
  }
}

/** Pick the highest-resolution image candidate from a media node. */
function bestCandidate(candidates: Array<{ url: string; width: number; height: number }>): MediaImage | null {
  if (!candidates || candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.width * c.height > best.width * best.height ? c : best));
}

/**
 * Detect whether the current page is a login/challenge/checkpoint screen.
 * Returns a short reason string if a challenge is present, otherwise null.
 */
export async function detectChallenge(page: Page): Promise<string | null> {
  const url = page.url();
  if (/\/challenge\//.test(url)) return 'challenge URL';
  if (/\/accounts\/login\//.test(url)) return 'login page';
  if (/\/accounts\/suspended\//.test(url)) return 'account suspended';

  // Heuristic text checks (best-effort, tolerant of DOM changes).
  const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  const lc = bodyText.toLowerCase();
  const markers = [
    'confirm it\'s you',
    'suspicious login',
    'we detected an unusual',
    'enter the code',
    'help us confirm',
    'try again later',
    'we restrict certain activity',
  ];
  for (const m of markers) {
    if (lc.includes(m)) return `challenge text: "${m}"`;
  }
  return null;
}

/**
 * Wait (up to `timeoutSeconds`) for a human to solve a challenge via noVNC.
 * Considered solved when the challenge markers disappear from the page.
 */
export async function waitForChallengeResolution(page: Page, timeoutSeconds: number): Promise<boolean> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const reason = await detectChallenge(page);
    if (!reason) return true;
  }
  return false;
}

/** Check whether we already have a logged-in session. */
export async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(true, 1500, 3000);
  // The `ds_user_id` cookie is present only for authenticated sessions.
  const cookies = await page.context().cookies(BASE);
  return cookies.some((c) => c.name === 'ds_user_id' && c.value.length > 0);
}

/**
 * Perform a username/password login. Handles the "save info" / "turn on
 * notifications" interstitials. Throws ChallengeError if a challenge appears
 * and is not resolved within the timeout.
 */
export async function login(
  page: Page,
  username: string,
  password: string,
  challengeTimeout: number,
): Promise<void> {
  log.info('Navigating to login page...');
  await page.goto(`${BASE}/accounts/login/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await humanDelay(true, 2000, 4000);

  // Accept cookie banner if present (EU).
  const cookieBtn = page.getByRole('button', { name: /allow all cookies|accept all/i });
  if (await cookieBtn.count().catch(() => 0)) {
    await cookieBtn.first().click().catch(() => {});
    await humanDelay(true);
  }

  await page.fill('input[name="username"]', username);
  await humanDelay(true, 500, 1200);
  await page.fill('input[name="password"]', password);
  await humanDelay(true, 500, 1200);
  await page.click('button[type="submit"]');

  // Wait for navigation / result.
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await humanDelay(true, 2000, 4000);

  const reason = await detectChallenge(page);
  if (reason) {
    log.warn(`Challenge detected during login (${reason}).`);
    await log.notify(
      `⚠️ Instagram challenge during login (${reason}). Open the addon (noVNC) and solve it within ${challengeTimeout}s.`,
    );
    const solved = await waitForChallengeResolution(page, challengeTimeout);
    if (!solved) {
      throw new ChallengeError(`Login challenge not resolved within ${challengeTimeout}s`);
    }
    await log.notify('✅ Challenge resolved, continuing.');
  }

  // Dismiss "Save login info" / "Turn on notifications" dialogs.
  for (const label of [/not now/i, /save info/i]) {
    const btn = page.getByRole('button', { name: label });
    if (await btn.count().catch(() => 0)) {
      await btn.first().click().catch(() => {});
      await humanDelay(true);
    }
  }

  if (!(await isLoggedIn(page))) {
    throw new Error('Login appears to have failed (no session cookie).');
  }
  log.info('Login successful.');
}

/** Resolve a username to its numeric user id via web_profile_info. */
export async function resolveUserId(page: Page, username: string): Promise<{ id: string; isPrivate: boolean; postCount: number }> {
  const result = await page.evaluate<
    { id: string; isPrivate: boolean; postCount: number } | { error: string },
    { username: string; appId: string; base: string }
  >(
    async ({ username, appId, base }) => {
      const res = await fetch(`${base}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
        headers: { 'x-ig-app-id': appId },
        credentials: 'include',
      });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      const data = await res.json();
      const user = data?.data?.user;
      if (!user) return { error: 'no user object' };
      return {
        id: user.id as string,
        isPrivate: Boolean(user.is_private),
        postCount: Number(user?.edge_owner_to_timeline_media?.count ?? 0),
      };
    },
    { username, appId: IG_APP_ID, base: BASE },
  );

  if ('error' in result) {
    throw new Error(`Failed to resolve @${username}: ${result.error}`);
  }
  return result;
}

interface FeedPage {
  posts: Post[];
  nextMaxId: string | null;
  moreAvailable: boolean;
}

interface ImageCandidate {
  url: string;
  width: number;
  height: number;
}

interface FeedMediaNode {
  image_versions2?: { candidates?: ImageCandidate[] };
}

interface FeedItem extends FeedMediaNode {
  code: string;
  taken_at: number;
  caption?: { text?: string } | null;
  carousel_media?: FeedMediaNode[];
}

interface FeedApiResponse {
  items?: FeedItem[];
  next_max_id?: string | null;
  more_available?: boolean;
}

/**
 * Fetch one page of a user's timeline feed.
 * `maxId` is the pagination cursor; pass null for the first (newest) page.
 */
export async function fetchFeedPage(
  page: Page,
  userId: string,
  count: number,
  maxId: string | null,
): Promise<FeedPage> {
  const raw = await page.evaluate<
    FeedApiResponse | { error: string },
    { userId: string; count: number; maxId: string | null; appId: string; base: string }
  >(
    async ({ userId, count, maxId, appId, base }) => {
      const params = new URLSearchParams({ count: String(count) });
      if (maxId) params.set('max_id', maxId);
      const res = await fetch(`${base}/api/v1/feed/user/${userId}/?${params.toString()}`, {
        headers: { 'x-ig-app-id': appId },
        credentials: 'include',
      });
      if (!res.ok) return { error: `HTTP ${res.status}` };
      return (await res.json()) as FeedApiResponse;
    },
    { userId, count, maxId, appId: IG_APP_ID, base: BASE },
  );

  if ('error' in raw) {
    throw new Error(`Feed fetch failed: ${raw.error}`);
  }

  const items = raw.items ?? [];
  const posts: Post[] = items.map((item) => {
    const shortcode: string = item.code;
    const takenAt: number = item.taken_at;
    const caption: string = item.caption?.text ?? '';

    const images: MediaImage[] = [];
    const collect = (node: FeedMediaNode) => {
      const cands = node?.image_versions2?.candidates ?? [];
      const best = bestCandidate(cands);
      if (best) images.push(best);
    };

    if (Array.isArray(item.carousel_media)) {
      for (const media of item.carousel_media) collect(media);
    } else {
      collect(item);
    }

    return { shortcode, takenAt, caption, images };
  });

  return {
    posts,
    nextMaxId: raw.next_max_id ?? null,
    moreAvailable: Boolean(raw.more_available),
  };
}

/** Ensure a browser page exists; opens a fresh one in the given context. */
export async function newPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  return page;
}
