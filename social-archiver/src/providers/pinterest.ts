import type { IngestCollection, IngestItem, IngestMedia, IngestProvider } from '../types.js';

/**
 * Pinterest source — `kind: 'query'`. `fetch(target)` takes a search query and
 * returns that query's pins plus its related ("guided") searches, scraped from
 * Pinterest's internal `/resource/BaseSearchResource/get/` JSON endpoint.
 *
 * ALL Pinterest-specific scraping lives in this file: the session bootstrap
 * (Byparr-rendered HOME page → `x-app-version` + `csrftoken`), the signed
 * resource calls, the bookmark pagination, and the defensive JSON parser. A
 * future endpoint change touches only this module — the orchestrator, storage
 * and notifier speak the source-agnostic `Ingest*` types.
 *
 * The parser (`parseSearchPage`) is deliberately a pure function over a parsed
 * JSON value so it can be unit-tested in isolation against a captured response.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE = 'https://www.pinterest.com';
const SEARCH_RESOURCE = `${BASE}/resource/BaseSearchResource/get/`;
/**
 * Page Byparr renders to bootstrap a session. We solve the HOME page, NOT a
 * per-query search page: the home page settles (`networkidle`) quickly, whereas
 * the infinite-scroll search page NEVER reaches networkidle and burns Byparr's
 * full `max_timeout` on every solve. The home solve returns the SAME usable
 * session (`csrftoken` + `_pinterest_sess` cookies + `x-app-version` from the
 * inline `__PWS_DATA__` JSON), which works for `BaseSearchResource` calls for
 * any query — so one home solve serves the whole run. Verified live against a
 * real Byparr 3.0.4 + Pinterest.
 */
const HOME_URL = `${BASE}/`;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** Pins requested per `/resource/` page (Pinterest's own default is 25). */
const PAGE_SIZE = 25;
/** Sentinel bookmark Pinterest returns when there are no further pages. */
const END_BOOKMARK = '-end-';
/**
 * Anti-stall guard for pagination. Pinterest search pages are mixed (pins +
 * story modules + ad units + suggestion carousels); the parser discards the
 * non-pin modules, so a page can legitimately yield 0 usable pins — or 0 pins
 * NEW to this query's `seen` set — while a valid `bookmark` still points at full
 * pages further on. We therefore keep following the bookmark and stop only after
 * this many CONSECUTIVE pages add zero new pins. One new pin resets the counter.
 */
const MAX_EMPTY_PAGES = 5;
/**
 * Session bootstrap retry policy. Byparr can return status `ok` while rendering
 * a Cloudflare interstitial/challenge instead of the real home page, in which
 * case `x-app-version` and/or the `csrftoken` cookie are absent. We retry the
 * solve a bounded number of times with an increasing backoff before giving up.
 */
const SESSION_MAX_ATTEMPTS = 3;
/** Base backoff (ms) between session solve attempts; grows per attempt. */
const SESSION_RETRY_BACKOFF_MS = 2_000;
/**
 * How many times a SINGLE failing query may force a mid-run session re-solve.
 * The shared session is created once and reused across all queries; if a query
 * hits a stale-session failure (missing csrftoken, or HTTP 401/403 from
 * BaseSearchResource) we re-solve the home session once, swap it in, and retry
 * THAT query once. If it still fails we surface the error and move on. We never
 * re-solve pre-emptively — only on an actual stale-session failure.
 */
const SESSION_RESOLVE_MAX = 1;

/**
 * Progressive-mp4 video formats in descending preference. `V_EXP7` is the
 * full-resolution source; `V_EXP3..6` are smaller transcodes. `V_HLSV*` entries
 * are HLS playlists (`.m3u8`), NOT single files, so they are intentionally
 * excluded — we only archive a directly-downloadable mp4.
 */
const MP4_FORMAT_PREFERENCE = ['V_EXP7', 'V_EXP6', 'V_EXP5', 'V_EXP4', 'V_EXP3'] as const;

// ─── Public shapes ─────────────────────────────────────────────────────────

export interface PinterestProviderOptions {
  /** Max bytes for a single media download (undefined → no cap). */
  maxDownloadBytes?: number;
  /** Byparr/FlareSolverr base URL. Required for real scraping. */
  byparrUrl?: string;
  /** Max time (ms) Byparr may spend on a single solve. */
  byparrTimeoutMs?: number;
  /** Hard cap on pins returned per query. */
  maxImages?: number;
  /** Injectable fetch, for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** A pin parsed out of the search response, before byte download is wired. */
export interface ParsedPin {
  id: string;
  type: 'image' | 'video';
  createdTime: string;
  caption: string;
  stats: Record<string, number>;
  url: string;
  /** Absolute media URL (orig/736x image, or best progressive mp4). */
  mediaUrl: string;
  mediaKind: IngestMedia['kind'];
}

/** The pure result of parsing one `/resource/` page. */
export interface ParsedSearchPage {
  pins: ParsedPin[];
  related: string[];
  /** Pinterest's pagination cursor; `-end-` (or empty) means no more pages. */
  bookmark: string;
}

// ─── Byparr session ──────────────────────────────────────────────────────────

/**
 * A resolved Pinterest session: everything needed to replay authenticated
 * `/resource/` requests and media downloads.
 */
export interface PinterestSession {
  /** `x-app-version` from the page's `__PWS_DATA__` JSON. */
  appVersion: string;
  /** `csrftoken` cookie value (sent back as `x-csrftoken`). */
  csrfToken: string;
  /** Serialized `name=value; …` cookie header for replay. */
  cookieHeader: string;
  /** User-Agent paired with the cookies (bound to Cloudflare clearance). */
  userAgent: string;
}

/** Minimal shape of a FlareSolverr/Byparr `POST /v1` reply we rely on. */
interface ByparrSolution {
  status?: string;
  solution?: {
    response?: string;
    userAgent?: string;
    cookies?: Array<{ name?: string; value?: string }>;
  };
}

/**
 * Marker for a BaseSearchResource failure that indicates a stale/invalid
 * session (an HTTP 401 or 403). The pagination loop lets this propagate so
 * `fetch()` can re-solve the session once and retry the query. Other HTTP
 * errors (e.g. 500) use a plain `Error` and are NOT treated as stale-session.
 */
class StaleSessionError extends Error {}

/** Resolve after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the search page URL for a query. The session is now solved from the
 * HOME page, so Byparr no longer renders this — but the per-query JSON call
 * still needs it as its `referer`/`source_url` (what Pinterest expects).
 */
export function searchPageUrl(query: string): string {
  return `${BASE}/search/pins/?q=${encodeURIComponent(query)}`;
}

/**
 * Extract `x-app-version` from a rendered Pinterest HTML page. The value lives
 * in the inline `<script id="__PWS_DATA__">` JSON as `"appVersion":"…"`; we read
 * it with a tight regex rather than parsing the (huge) blob. Returns undefined
 * when absent so the caller can fail with a clear message.
 */
export function extractAppVersion(html: string): string | undefined {
  const m = html.match(/"appVersion"\s*:\s*"([^"]+)"/);
  return m ? m[1] : undefined;
}

/** Read a named cookie from an array of Byparr cookie objects. */
function cookieValue(
  cookies: Array<{ name?: string; value?: string }>,
  name: string,
): string | undefined {
  for (const c of cookies) {
    if (c && c.name === name && typeof c.value === 'string') return c.value;
  }
  return undefined;
}

// ─── Provider ─────────────────────────────────────────────────────────────

export class PinterestProvider implements IngestProvider {
  readonly name = 'pinterest';
  readonly kind = 'query' as const;
  private readonly fetchImpl: typeof fetch;
  /**
   * Shared, lazily-created Byparr session reused across every `fetch(query)`
   * in a run. The first query that needs Pinterest triggers exactly one home
   * solve; later queries reuse it. A stale-session failure swaps in a fresh
   * one (see `refreshSession`). `undefined` until the first solve — so a run
   * with zero queries (where `fetch` is never called) never solves at all.
   */
  private session?: Promise<PinterestSession>;

  constructor(private readonly options: PinterestProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async fetch(query: string): Promise<IngestCollection> {
    if (!this.options.byparrUrl) {
      throw new Error(
        '[pinterest] SA_BYPARR_URL is not configured — Pinterest needs a Byparr instance ' +
          'to render the home page and clear Cloudflare.',
      );
    }

    let session = await this.getSession();

    // One mid-run re-solve budget for THIS query on a stale-session failure.
    let resolves = 0;
    for (;;) {
      try {
        return await this.collectQuery(query, session);
      } catch (err) {
        if (err instanceof StaleSessionError && resolves < SESSION_RESOLVE_MAX) {
          resolves++;
          console.warn(
            `[pinterest:${query}] session looks stale (${err.message}); ` +
              're-solving the home session and retrying this query once.',
          );
          session = await this.refreshSession();
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Run the BFS/pagination for one query against a given session. Pulled out of
   * `fetch` so the caller can retry it with a freshly re-solved session on a
   * stale-session failure without re-running the solve retry loop.
   */
  private async collectQuery(
    query: string,
    session: PinterestSession,
  ): Promise<IngestCollection> {
    const maxImages = this.options.maxImages ?? Number.POSITIVE_INFINITY;
    const items: IngestItem[] = [];
    const seen = new Set<string>();
    const related = new Set<string>();
    let bookmark: string | undefined;
    // Count of consecutive pages that added zero pins NEW to `seen`. Covers both
    // failure modes: a page of only story/ad modules (0 parsed pins) AND a page
    // whose pins are all already in `seen` (all dedup'd). Resets to 0 whenever a
    // page contributes at least one new pin.
    let emptyPageRun = 0;

    // Paginate until we have enough pins or the bookmark signals the end.
    for (;;) {
      const page = await this.fetchResourcePage(query, session, bookmark);

      for (const r of page.related) related.add(r);

      let addedThisPage = 0;
      for (const pin of page.pins) {
        if (seen.has(pin.id)) continue;
        seen.add(pin.id);
        addedThisPage++;
        items.push(this.toIngestItem(pin, session));
        if (items.length >= maxImages) break;
      }

      emptyPageRun = addedThisPage === 0 ? emptyPageRun + 1 : 0;

      if (items.length >= maxImages) break;
      if (!page.bookmark || page.bookmark === END_BOOKMARK) break;
      // Stop only after a run of consecutive zero-new-pin pages; a single empty
      // page is expected (mixed modules / dedup) and must NOT end pagination.
      if (emptyPageRun >= MAX_EMPTY_PAGES) break;
      bookmark = page.bookmark;
    }

    return { items, related: [...related] };
  }

  /**
   * Return the shared session, solving it lazily on first use. Subsequent calls
   * reuse the cached promise so a run does exactly one home solve. The cached
   * value is a promise (not the resolved session) so concurrent first callers
   * share a single in-flight solve.
   *
   * If the solve REJECTS, the rejected promise must NOT stay cached — otherwise
   * a single early Byparr hiccup would poison every later query in the run,
   * which would each reuse the failed promise and never re-solve. So we clear
   * `this.session` on rejection, letting the next query attempt a fresh solve.
   */
  private getSession(): Promise<PinterestSession> {
    if (!this.session) {
      const pending = this.solveSession();
      // Drop the cache on failure so the next query re-solves; keep it on success.
      pending.catch(() => {
        if (this.session === pending) this.session = undefined;
      });
      this.session = pending;
    }
    return this.session;
  }

  /**
   * Force a fresh home solve, replacing the shared session, and return it. Used
   * only when a query hits a stale-session failure; the new session stays in
   * place for subsequent queries.
   */
  private refreshSession(): Promise<PinterestSession> {
    this.session = this.solveSession();
    return this.session;
  }

  /**
   * Bootstrap a Pinterest session through Byparr: render the HOME page to clear
   * Cloudflare, then read `x-app-version` from the page HTML and the
   * `csrftoken` cookie. Talks to Byparr's FlareSolverr-compatible `POST /v1`
   * directly (not the client's `ByparrSolver`) because we need the rendered
   * HTML body, which the solver's `solve()` does not expose.
   */
  private async solveSession(): Promise<PinterestSession> {
    // Byparr intermittently returns an ok-but-unusable solve (a Cloudflare
    // interstitial, missing x-app-version and/or csrftoken). Retry a bounded
    // number of times with an increasing backoff before surfacing the error.
    let lastError: unknown;
    for (let attempt = 1; attempt <= SESSION_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.solveSessionOnce();
      } catch (err) {
        lastError = err;
        if (attempt < SESSION_MAX_ATTEMPTS) {
          const backoff = SESSION_RETRY_BACKOFF_MS * attempt;
          console.warn(
            `[pinterest] session bootstrap attempt ${attempt}/${SESSION_MAX_ATTEMPTS} failed ` +
              `(${err instanceof Error ? err.message : String(err)}); ` +
              `retrying in ${backoff}ms`,
          );
          await sleep(backoff);
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`[pinterest] session bootstrap failed: ${String(lastError)}`);
  }

  /**
   * A single Byparr solve attempt. Throws on non-ok HTTP, an unsolved page, a
   * missing `x-app-version`, or a missing `csrftoken` cookie — each of which the
   * retrying `solveSession()` treats as a transient failure.
   */
  private async solveSessionOnce(): Promise<PinterestSession> {
    const base = (this.options.byparrUrl as string).replace(/\/+$/, '');
    const maxTimeout = this.options.byparrTimeoutMs ?? 60_000;
    const body = {
      cmd: 'request.get',
      url: HOME_URL,
      maxTimeout,
    };

    const res = await this.fetchImpl(`${base}/v1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`[pinterest] Byparr /v1 returned HTTP ${res.status}`);
    }

    const parsed = (await res.json()) as ByparrSolution;
    if (parsed.status !== 'ok' || !parsed.solution) {
      throw new Error(`[pinterest] Byparr did not solve the page (status: ${parsed.status}).`);
    }

    const html = parsed.solution.response ?? '';
    const appVersion = extractAppVersion(html);
    if (!appVersion) {
      throw new Error('[pinterest] Could not find x-app-version in the rendered home page.');
    }

    const cookies = Array.isArray(parsed.solution.cookies) ? parsed.solution.cookies : [];
    const csrfToken = cookieValue(cookies, 'csrftoken');
    if (!csrfToken) {
      throw new Error('[pinterest] csrftoken cookie missing from the Byparr session.');
    }

    const cookieHeader = cookies
      .filter((c) => c && typeof c.name === 'string' && typeof c.value === 'string')
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    return {
      appVersion,
      csrfToken,
      cookieHeader,
      userAgent: parsed.solution.userAgent ?? DEFAULT_USER_AGENT,
    };
  }

  /** Fetch one `/resource/` page and parse it. `bookmark` paginates. */
  private async fetchResourcePage(
    query: string,
    session: PinterestSession,
    bookmark: string | undefined,
  ): Promise<ParsedSearchPage> {
    const options: Record<string, unknown> = {
      query,
      scope: 'pins',
      page_size: PAGE_SIZE,
      // gated:false is what returns FULL pins (title/description/board/orig
      // image) instead of stubbed grid cells.
      gated: false,
    };
    if (bookmark) options.bookmarks = [bookmark];

    const data = JSON.stringify({ options, context: {} });
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}`;
    const params = new URLSearchParams({ source_url: sourceUrl, data });
    const url = `${SEARCH_RESOURCE}?${params.toString()}`;

    const res = await this.fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        'x-app-version': session.appVersion,
        'x-pinterest-pws-handler': 'www/index.js',
        'x-csrftoken': session.csrfToken,
        referer: searchPageUrl(query),
        cookie: session.cookieHeader,
        'user-agent': session.userAgent,
      },
    });
    if (!res.ok) {
      // 401/403 mean the session's auth was rejected (expired/invalid) — signal
      // a stale session so `fetch` can re-solve once. Other codes (e.g. 500) are
      // plain errors and surface to the orchestrator as today.
      if (res.status === 401 || res.status === 403) {
        throw new StaleSessionError(
          `[pinterest] BaseSearchResource returned HTTP ${res.status}`,
        );
      }
      throw new Error(`[pinterest] BaseSearchResource returned HTTP ${res.status}`);
    }

    const json: unknown = await res.json();
    return parseSearchPage(json);
  }

  /** Wire a parsed pin to a lazily-downloaded `IngestItem`. */
  private toIngestItem(pin: ParsedPin, session: PinterestSession): IngestItem {
    const media: IngestMedia = {
      kind: pin.mediaKind,
      download: () => this.downloadMedia(pin.mediaUrl, session),
    };
    return {
      id: pin.id,
      type: pin.type,
      createdTime: pin.createdTime,
      caption: pin.caption,
      stats: pin.stats,
      url: pin.url,
      media: [media],
      source: this.name,
    };
  }

  /**
   * Download media bytes, replaying the Byparr session (cookies + UA) and the
   * Referer the pinimg CDN expects. The orchestrator/storage layer serializes
   * these calls with `request_delay_ms`, so no delay is applied here.
   */
  private async downloadMedia(mediaUrl: string, session: PinterestSession): Promise<Uint8Array> {
    const res = await this.fetchImpl(mediaUrl, {
      headers: {
        referer: `${BASE}/`,
        cookie: session.cookieHeader,
        'user-agent': session.userAgent,
      },
    });
    if (!res.ok) {
      throw new Error(`[pinterest] media download failed: HTTP ${res.status} (${mediaUrl})`);
    }

    const max = this.options.maxDownloadBytes;
    const declared = Number(res.headers.get('content-length'));
    if (max !== undefined && Number.isFinite(declared) && declared > max) {
      throw new Error(
        `[pinterest] media too large: ${declared} bytes > cap ${max} (${mediaUrl})`,
      );
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (max !== undefined && bytes.byteLength > max) {
      throw new Error(
        `[pinterest] media too large: ${bytes.byteLength} bytes > cap ${max} (${mediaUrl})`,
      );
    }
    return bytes;
  }
}

// ─── Pure parser (unit-testable) ──────────────────────────────────────────

/** Narrow an unknown to a plain object (not null, not array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Convert Pinterest's RFC-1123 `created_at` ("Sat, 24 Oct 2026 01:22:29 +0000")
 * to ISO-8601. Falls back to the raw string when it cannot be parsed, matching
 * the Instagram provider's defensive `toIso`.
 */
export function pinterestDateToIso(raw: string): string {
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return raw;
  return new Date(t).toISOString();
}

/** Best image URL for a pin: prefer `orig`, fall back to `736x`. */
function pickImageUrl(images: unknown): string | undefined {
  if (!isRecord(images)) return undefined;
  const orig = images.orig;
  if (isRecord(orig)) {
    const u = asString(orig.url);
    if (u) return u;
  }
  const medium = images['736x'];
  if (isRecord(medium)) {
    const u = asString(medium.url);
    if (u) return u;
  }
  return undefined;
}

/** Pick the best progressive-mp4 URL from a `video_list`, ignoring HLS. */
function pickMp4FromVideoList(videoList: unknown): string | undefined {
  if (!isRecord(videoList)) return undefined;
  for (const fmt of MP4_FORMAT_PREFERENCE) {
    const entry = videoList[fmt];
    if (isRecord(entry)) {
      const u = asString(entry.url);
      if (u && u.endsWith('.mp4')) return u;
    }
  }
  // Fallback: any entry whose URL is an mp4.
  for (const key of Object.keys(videoList)) {
    const entry = videoList[key];
    if (isRecord(entry)) {
      const u = asString(entry.url);
      if (u && u.endsWith('.mp4')) return u;
    }
  }
  return undefined;
}

/**
 * Find a pin's mp4 URL. Regular video pins carry `videos.video_list`; idea/story
 * pins carry it under `story_pin_data.pages[].blocks[].video.video_list`. We
 * scan both and return the first mp4 found (first page/block wins).
 */
function findVideoUrl(pin: Record<string, unknown>): string | undefined {
  const videos = pin.videos;
  if (isRecord(videos)) {
    const u = pickMp4FromVideoList(videos.video_list);
    if (u) return u;
  }

  const spd = pin.story_pin_data;
  if (isRecord(spd) && Array.isArray(spd.pages)) {
    for (const page of spd.pages) {
      if (!isRecord(page) || !Array.isArray(page.blocks)) continue;
      for (const block of page.blocks) {
        if (!isRecord(block)) continue;
        const video = block.video;
        if (isRecord(video)) {
          const u = pickMp4FromVideoList(video.video_list);
          if (u) return u;
        }
      }
    }
  }
  return undefined;
}

/** Caption for a pin: description, else title, else grid_title, else "". */
function pickCaption(pin: Record<string, unknown>): string {
  return (
    asString(pin.description)?.trim() ||
    asString(pin.title)?.trim() ||
    asString(pin.grid_title)?.trim() ||
    ''
  );
}

/**
 * Build the per-pin stats map. Pinterest exposes engagement inconsistently
 * across response shapes, so we collect whatever is present (the map may end up
 * empty, with just one key, or several):
 *
 * - `saves` — from `repin_count`, falling back to
 *   `aggregated_pin_data.aggregated_stats.saves`. Search responses often omit
 *   both (`repin_count` absent, `aggregated_pin_data` carries only a node_id),
 *   in which case `saves` is simply not recorded.
 * - `reactions` — the total of `reaction_counts` (e.g. `{ "1": 46 }`, where key
 *   `"1"` is the default "👍" reaction). Search responses that drop saves
 *   usually still carry this, so it is the one engagement signal we can rely on.
 */
function pickStats(pin: Record<string, unknown>): Record<string, number> {
  const stats: Record<string, number> = {};

  const saves = pickSaves(pin);
  if (saves !== undefined) stats.saves = saves;

  const reactions = pickReactions(pin);
  if (reactions !== undefined) stats.reactions = reactions;

  return stats;
}

/** Saves for a pin: `repin_count`, else `aggregated_stats.saves`, else none. */
function pickSaves(pin: Record<string, unknown>): number | undefined {
  const repin = pin.repin_count;
  if (typeof repin === 'number' && Number.isFinite(repin)) return repin;

  const agg = pin.aggregated_pin_data;
  if (isRecord(agg) && isRecord(agg.aggregated_stats)) {
    const saves = agg.aggregated_stats.saves;
    if (typeof saves === 'number' && Number.isFinite(saves)) return saves;
  }
  return undefined;
}

/**
 * Total reactions from `reaction_counts` (a map of reaction-type → count, e.g.
 * `{ "1": 46 }`). Sums every type so the number stays correct if Pinterest ever
 * returns more than the default reaction. Returns undefined when absent or zero.
 */
function pickReactions(pin: Record<string, unknown>): number | undefined {
  const counts = pin.reaction_counts;
  if (!isRecord(counts)) return undefined;
  let total = 0;
  for (const v of Object.values(counts)) {
    if (typeof v === 'number' && Number.isFinite(v)) total += v;
  }
  return total > 0 ? total : undefined;
}

/** Map one raw pin object to a `ParsedPin`, or undefined if unusable. */
function parsePin(raw: unknown): ParsedPin | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.type !== undefined && raw.type !== 'pin') return undefined;
  const id = asString(raw.id);
  if (!id) return undefined;

  const createdTime = pinterestDateToIso(asString(raw.created_at) ?? '');
  const caption = pickCaption(raw);
  const stats = pickStats(raw);
  const url = `${BASE}/pin/${id}/`;

  // Prefer an mp4 (video pin); fall back to the still image.
  const videoUrl = findVideoUrl(raw);
  if (videoUrl) {
    return {
      id,
      type: 'video',
      createdTime,
      caption,
      stats,
      url,
      mediaUrl: videoUrl,
      mediaKind: 'video',
    };
  }

  const imageUrl = pickImageUrl(raw.images);
  if (imageUrl) {
    return {
      id,
      type: 'image',
      createdTime,
      caption,
      stats,
      url,
      mediaUrl: imageUrl,
      mediaKind: 'image',
    };
  }

  // No usable media (neither mp4 nor image) → skip.
  return undefined;
}

/** Extract related ("guided") searches from `data.rankedGuides[].term`. */
function parseRelated(data: Record<string, unknown>): string[] {
  const guides = data.rankedGuides;
  if (!Array.isArray(guides)) return [];
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const g of guides) {
    if (!isRecord(g)) continue;
    const term = asString(g.term)?.trim();
    if (term && !seen.has(term)) {
      seen.add(term);
      terms.push(term);
    }
  }
  return terms;
}

/**
 * Parse one `BaseSearchResource` response into pins + related searches +
 * pagination bookmark. Pure and defensive: every field is validated, unexpected
 * shapes yield empty results rather than throwing, so a changed/hostile payload
 * degrades gracefully. This is the unit-tested seam.
 */
export function parseSearchPage(json: unknown): ParsedSearchPage {
  const empty: ParsedSearchPage = { pins: [], related: [], bookmark: '' };
  if (!isRecord(json)) return empty;

  const rr = json.resource_response;
  if (!isRecord(rr)) return empty;

  const bookmark = asString(rr.bookmark) ?? '';

  const data = rr.data;
  if (!isRecord(data)) return { pins: [], related: [], bookmark };

  const results = Array.isArray(data.results) ? data.results : [];
  const pins: ParsedPin[] = [];
  for (const r of results) {
    const pin = parsePin(r);
    if (pin) pins.push(pin);
  }

  return { pins, related: parseRelated(data), bookmark };
}
