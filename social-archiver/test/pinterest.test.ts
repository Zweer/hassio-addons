import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  extractAppVersion,
  parseSearchPage,
  pinterestDateToIso,
  PinterestProvider,
  searchPageUrl,
} from '../src/providers/pinterest.js';

const here = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));
}
const page1 = fixture('base-search-page1.json');
const page2 = fixture('base-search-page2.json');

describe('pinterestDateToIso', () => {
  it('converts RFC-1123 to ISO-8601', () => {
    expect(pinterestDateToIso('Sat, 24 Oct 2026 01:22:29 +0000')).toBe('2026-10-24T01:22:29.000Z');
  });
  it('falls back to the raw string when unparseable', () => {
    expect(pinterestDateToIso('not a date')).toBe('not a date');
    expect(pinterestDateToIso('')).toBe('');
  });
});

describe('extractAppVersion', () => {
  it('reads appVersion from the __PWS_DATA__ blob', () => {
    const html = '<script id="__PWS_DATA__" type="application/json">{"appVersion":"20eebb3","x":1}</script>';
    expect(extractAppVersion(html)).toBe('20eebb3');
  });
  it('returns undefined when absent', () => {
    expect(extractAppVersion('<html>no data</html>')).toBeUndefined();
  });
});

describe('searchPageUrl', () => {
  it('url-encodes the query', () => {
    expect(searchPageUrl('boardroom outfit women 2026')).toBe(
      'https://www.pinterest.com/search/pins/?q=boardroom%20outfit%20women%202026',
    );
  });
});

describe('parseSearchPage', () => {
  it('parses image and video pins, stats, url and bookmark (page 1)', () => {
    const { pins, related, bookmark } = parseSearchPage(page1);
    expect(bookmark).toBe('BOOKMARK_PAGE_2');
    expect(pins).toHaveLength(2);

    const [img, vid] = pins;
    // Image pin: orig url, saves from aggregated_stats (repin_count is null).
    expect(img.type).toBe('image');
    expect(img.mediaKind).toBe('image');
    expect(img.mediaUrl).toContain('/originals/');
    expect(img.mediaUrl.endsWith('.png')).toBe(true);
    expect(img.stats).toEqual({ saves: 4242 });
    expect(img.url).toBe(
      'https://www.pinterest.com/pin/e1_AfqPShy7-ISZhFLIA8mogBpsA1D941jdxxKVhzvNLQVAyOlBbH1D/',
    );
    expect(img.createdTime).toBe('2026-10-24T01:22:29.000Z');
    expect(img.caption).toContain('Hot Honey Garlic Chicken Bowls');

    // Video pin (idea pin): best mp4 is V_EXP7, HLS ignored; saves from repin_count.
    expect(vid.type).toBe('video');
    expect(vid.mediaKind).toBe('video');
    expect(vid.mediaUrl).toBe(
      'https://v1.pinimg.com/videos/mc/720p/d6/20/b3/d620b3ac91fab04f0abad07a9a8f9542.mp4',
    );
    expect(vid.stats).toEqual({ saves: 5 });
    // description is just " " → falls back to title.
    expect(vid.caption).toBe('Cook with Sue');
  });

  it('dedupes related searches from rankedGuides[].term', () => {
    const { related } = parseSearchPage(page1);
    expect(related).toEqual(['food recipes', 'dinner recipes', 'healthy dinner recipes']);
  });

  it('falls back to 736x and skips non-pins and media-less pins (page 2)', () => {
    const { pins, related, bookmark } = parseSearchPage(page2);
    expect(bookmark).toBe('-end-');
    expect(related).toEqual([]);
    // Only the 736x-only image pin survives; "story" + media-less pin dropped.
    expect(pins).toHaveLength(1);
    expect(pins[0].id).toBe('pin_only_736');
    expect(pins[0].mediaUrl.endsWith('.jpg')).toBe(true);
    expect(pins[0].mediaUrl).toContain('/736x/');
  });

  it('degrades gracefully on malformed/hostile payloads', () => {
    expect(parseSearchPage(null)).toEqual({ pins: [], related: [], bookmark: '' });
    expect(parseSearchPage('nope')).toEqual({ pins: [], related: [], bookmark: '' });
    expect(parseSearchPage({ resource_response: {} })).toEqual({
      pins: [],
      related: [],
      bookmark: '',
    });
    expect(parseSearchPage({ resource_response: { bookmark: 'b', data: { results: 'x' } } })).toEqual(
      { pins: [], related: [], bookmark: 'b' },
    );
  });

  // Build a minimal search page around a single pin object (real search
  // responses carry engagement differently than the recipe fixtures).
  function pageWithPin(pin: Record<string, unknown>): unknown {
    return {
      resource_response: {
        bookmark: '-end-',
        data: { results: [{ id: 'p1', images: { orig: { url: 'https://i/x.jpg' } }, ...pin }] },
      },
    };
  }
  const statsOf = (page: unknown) => parseSearchPage(page).pins[0].stats;

  describe('stats extraction', () => {
    it('reads reactions from reaction_counts when saves are absent (real search shape)', () => {
      // Observed live: repin_count missing, aggregated_pin_data carries only a
      // node_id (no aggregated_stats), reaction_counts present.
      expect(
        statsOf(
          pageWithPin({
            aggregated_pin_data: { node_id: 'QWdncmVn' },
            reaction_counts: { '1': 46 },
          }),
        ),
      ).toEqual({ reactions: 46 });
    });

    it('sums every reaction type', () => {
      expect(statsOf(pageWithPin({ reaction_counts: { '1': 40, '2': 2 } }))).toEqual({
        reactions: 42,
      });
    });

    it('records both saves and reactions when both are present', () => {
      expect(statsOf(pageWithPin({ repin_count: 10, reaction_counts: { '1': 3 } }))).toEqual({
        saves: 10,
        reactions: 3,
      });
    });

    it('is empty when no engagement is exposed', () => {
      expect(statsOf(pageWithPin({ reaction_counts: {} }))).toEqual({});
      expect(statsOf(pageWithPin({}))).toEqual({});
    });
  });
});

describe('PinterestProvider.fetch (mocked fetch)', () => {
  const BYPARR = 'http://byparr.local:8191';

  /** Build a fetch stub: Byparr /v1 → page1 → page2 → media bytes. */
  function makeFetch(pages: unknown[]) {
    let pageIdx = 0;
    const calls: string[] = [];
    const fetchStub = vi.fn(async (input: string | URL | Request) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      calls.push(urlStr);

      if (urlStr.endsWith('/v1')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            solution: {
              response: '<script id="__PWS_DATA__">{"appVersion":"20eebb3"}</script>',
              userAgent: 'TestUA/1.0',
              cookies: [
                { name: 'csrftoken', value: 'CSRF123' },
                { name: '_pinterest_sess', value: 'SESS456' },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (urlStr.includes('/resource/BaseSearchResource/get/')) {
        const body = JSON.stringify(pages[Math.min(pageIdx, pages.length - 1)]);
        pageIdx++;
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      // Media download.
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    });
    return { fetchStub, calls };
  }

  it('throws when Byparr is not configured', async () => {
    const provider = new PinterestProvider({});
    await expect(provider.fetch('q')).rejects.toThrow(/SA_BYPARR_URL/);
  });

  it('paginates, dedupes pins, aggregates related, and downloads media', async () => {
    const { fetchStub, calls } = makeFetch([page1, page2]);
    const provider = new PinterestProvider({
      byparrUrl: BYPARR,
      fetch: fetchStub as unknown as typeof fetch,
    });

    const collection = await provider.fetch('recipes');

    // page1 (2 pins) + page2 (1 usable pin) = 3 unique items.
    expect(collection.items).toHaveLength(3);
    expect(collection.items.map((i) => i.id)).toEqual([
      'e1_AfqPShy7-ISZhFLIA8mogBpsA1D941jdxxKVhzvNLQVAyOlBbH1D',
      'e1_AfqPShz4aWBJaiCQsDaFEyaLc0nx5DZuWe_5eGu-jn9VRIXzXKH6',
      'pin_only_736',
    ]);
    expect(collection.items.every((i) => i.source === 'pinterest')).toBe(true);

    // Related searches came only from page1.
    expect(collection.related).toEqual([
      'food recipes',
      'dinner recipes',
      'healthy dinner recipes',
    ]);

    // Byparr solve (/v1) + 2 resource pages were requested.
    expect(calls.filter((c) => c.endsWith('/v1'))).toHaveLength(1);
    expect(
      calls.filter((c) => c.includes('/resource/BaseSearchResource/get/')),
    ).toHaveLength(2);

    // Lazy media download works and returns bytes.
    const bytes = await collection.items[0].media[0].download();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(4);
  });

  it('stops paginating once maxImages is reached (no second page fetched)', async () => {
    const { fetchStub, calls } = makeFetch([page1, page2]);
    const provider = new PinterestProvider({
      byparrUrl: BYPARR,
      maxImages: 1,
      fetch: fetchStub as unknown as typeof fetch,
    });

    const collection = await provider.fetch('recipes');
    expect(collection.items).toHaveLength(1);
    // Only one resource page should have been fetched.
    expect(
      calls.filter((c) => c.includes('/resource/BaseSearchResource/get/')),
    ).toHaveLength(1);
  });

  it('sends session headers (x-app-version, x-csrftoken, cookie) on resource calls', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchStub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      if (urlStr.endsWith('/v1')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            solution: {
              response: '{"appVersion":"20eebb3"}',
              userAgent: 'TestUA/1.0',
              cookies: [{ name: 'csrftoken', value: 'CSRF123' }],
            },
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes('/resource/')) {
        seen.push((init?.headers ?? {}) as Record<string, string>);
        return new Response(JSON.stringify(page2), { status: 200 });
      }
      return new Response(new Uint8Array([1]), { status: 200 });
    });

    const provider = new PinterestProvider({
      byparrUrl: BYPARR,
      fetch: fetchStub as unknown as typeof fetch,
    });
    await provider.fetch('recipes');

    expect(seen).toHaveLength(1);
    expect(seen[0]['x-app-version']).toBe('20eebb3');
    expect(seen[0]['x-csrftoken']).toBe('CSRF123');
    expect(seen[0]['x-pinterest-pws-handler']).toBe('www/index.js');
    expect(seen[0]['x-requested-with']).toBe('XMLHttpRequest');
    expect(seen[0].cookie).toContain('csrftoken=CSRF123');
  });

  it('fails clearly when the rendered page lacks an app version', async () => {
    // Session bootstrap now retries with backoff, so drive timers to avoid the
    // real delay while still asserting the final clear error.
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fetchStub = vi.fn(async () =>
        new Response(
          JSON.stringify({ status: 'ok', solution: { response: '<html></html>', cookies: [] } }),
          { status: 200 },
        ),
      );
      const provider = new PinterestProvider({
        byparrUrl: BYPARR,
        fetch: fetchStub as unknown as typeof fetch,
      });
      const promise = provider.fetch('q');
      const assertion = expect(promise).rejects.toThrow(/x-app-version/);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('PinterestProvider.fetch pagination (anti-stall guard)', () => {
  const BYPARR = 'http://byparr.local:8191';

  /** A usable Byparr /v1 response. */
  function byparrOk(): Response {
    return new Response(
      JSON.stringify({
        status: 'ok',
        solution: {
          response: '<script id="__PWS_DATA__">{"appVersion":"20eebb3"}</script>',
          userAgent: 'TestUA/1.0',
          cookies: [{ name: 'csrftoken', value: 'CSRF123' }],
        },
      }),
      { status: 200 },
    );
  }

  /** Build a search page carrying the given pin ids with a chosen bookmark. */
  function searchPage(ids: string[], bookmark: string): unknown {
    return {
      resource_response: {
        bookmark,
        data: {
          results: ids.map((id) => ({
            id,
            type: 'pin',
            images: { orig: { url: `https://i/${id}.jpg` } },
          })),
        },
      },
    };
  }

  /**
   * Fetch stub that serves a scripted list of resource pages in order, then a
   * trivial media response. Records how many resource pages were requested.
   */
  function makeFetch(pages: unknown[]) {
    let pageIdx = 0;
    let resourceCalls = 0;
    const fetchStub = vi.fn(async (input: string | URL | Request) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      if (urlStr.endsWith('/v1')) return byparrOk();
      if (urlStr.includes('/resource/BaseSearchResource/get/')) {
        resourceCalls++;
        const body = JSON.stringify(pages[Math.min(pageIdx, pages.length - 1)]);
        pageIdx++;
        return new Response(body, { status: 200 });
      }
      return new Response(new Uint8Array([1]), { status: 200 });
    });
    return { fetchStub, resourceCalls: () => resourceCalls };
  }

  it('follows the bookmark past empty / story-only pages (0 parsed pins)', async () => {
    // Pages 2–4 parse to zero pins (story-only), page 5 has a real pin, page 6 ends.
    const pages = [
      searchPage(['a'], 'BM2'),
      searchPage([], 'BM3'),
      searchPage([], 'BM4'),
      searchPage([], 'BM5'),
      searchPage(['b'], 'BM6'),
      searchPage(['c'], '-end-'),
    ];
    const { fetchStub, resourceCalls } = makeFetch(pages);
    const provider = new PinterestProvider({
      byparrUrl: BYPARR,
      fetch: fetchStub as unknown as typeof fetch,
    });

    const collection = await provider.fetch('q');
    // Would be just ['a'] under the old single-empty-page break.
    expect(collection.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(resourceCalls()).toBe(6);
  });

  it('treats all-dedup pages (zero NEW pins) as empty for the guard', async () => {
    // Page 1 has pin 'a'; pages 2–6 repeat only 'a' (all dedup'd → zero new).
    // After 5 consecutive zero-new pages, pagination stops.
    const repeat = searchPage(['a'], 'NEXT');
    const pages = [searchPage(['a'], 'NEXT'), repeat, repeat, repeat, repeat, repeat, repeat];
    const { fetchStub, resourceCalls } = makeFetch(pages);
    const provider = new PinterestProvider({
      byparrUrl: BYPARR,
      fetch: fetchStub as unknown as typeof fetch,
    });

    const collection = await provider.fetch('q');
    expect(collection.items.map((i) => i.id)).toEqual(['a']);
    // page1 (new) + 5 consecutive zero-new pages = 6 resource calls, then stop.
    expect(resourceCalls()).toBe(6);
  });

  it('a new pin resets the consecutive-empty counter', async () => {
    // zero-new runs of length 4 twice, each broken by a new pin → never stops
    // on the guard; only -end- stops it.
    const a = searchPage(['a'], 'b1');
    const empty = searchPage([], 'b1');
    const pages = [
      a, // +a
      empty,
      empty,
      empty,
      empty, // run = 4
      searchPage(['b'], 'b2'), // +b resets run to 0
      empty,
      empty,
      empty,
      empty, // run = 4
      searchPage(['c'], '-end-'), // +c, then -end- stops
    ];
    const { fetchStub, resourceCalls } = makeFetch(pages);
    const provider = new PinterestProvider({
      byparrUrl: BYPARR,
      fetch: fetchStub as unknown as typeof fetch,
    });

    const collection = await provider.fetch('q');
    expect(collection.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(resourceCalls()).toBe(11);
  });

  it('stops on the -end- bookmark even with pins present', async () => {
    const pages = [searchPage(['a'], 'BM2'), searchPage(['b'], '-end-'), searchPage(['c'], 'BM4')];
    const { fetchStub, resourceCalls } = makeFetch(pages);
    const provider = new PinterestProvider({
      byparrUrl: BYPARR,
      fetch: fetchStub as unknown as typeof fetch,
    });

    const collection = await provider.fetch('q');
    expect(collection.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(resourceCalls()).toBe(2);
  });

  it('stops on maxImages mid-pagination', async () => {
    const pages = [searchPage(['a', 'b'], 'BM2'), searchPage(['c'], 'BM3')];
    const { fetchStub, resourceCalls } = makeFetch(pages);
    const provider = new PinterestProvider({
      byparrUrl: BYPARR,
      maxImages: 2,
      fetch: fetchStub as unknown as typeof fetch,
    });

    const collection = await provider.fetch('q');
    expect(collection.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(resourceCalls()).toBe(1);
  });
});

describe('PinterestProvider.solveSession retry', () => {
  const BYPARR = 'http://byparr.local:8191';

  /** A usable solve (app version + csrftoken present). */
  function usable(): Response {
    return new Response(
      JSON.stringify({
        status: 'ok',
        solution: {
          response: '<script id="__PWS_DATA__">{"appVersion":"20eebb3"}</script>',
          userAgent: 'TestUA/1.0',
          cookies: [{ name: 'csrftoken', value: 'CSRF123' }],
        },
      }),
      { status: 200 },
    );
  }

  /** An ok-but-unusable solve missing the csrftoken cookie. */
  function missingCsrf(): Response {
    return new Response(
      JSON.stringify({
        status: 'ok',
        solution: {
          response: '<script id="__PWS_DATA__">{"appVersion":"20eebb3"}</script>',
          userAgent: 'TestUA/1.0',
          cookies: [],
        },
      }),
      { status: 200 },
    );
  }

  /** An ok-but-unusable solve missing the app version (Cloudflare interstitial). */
  function missingAppVersion(): Response {
    return new Response(
      JSON.stringify({
        status: 'ok',
        solution: { response: '<html>challenge</html>', userAgent: 'TestUA/1.0', cookies: [] },
      }),
      { status: 200 },
    );
  }

  const endPage = JSON.stringify({ resource_response: { bookmark: '-end-', data: { results: [] } } });

  it('retries after unusable solves and succeeds on a later attempt', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const v1Responses = [missingCsrf(), missingAppVersion(), usable()];
      let v1Idx = 0;
      const fetchStub = vi.fn(async (input: string | URL | Request) => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        if (urlStr.endsWith('/v1')) return v1Responses[v1Idx++];
        return new Response(endPage, { status: 200 });
      });

      const provider = new PinterestProvider({
        byparrUrl: BYPARR,
        fetch: fetchStub as unknown as typeof fetch,
      });

      const promise = provider.fetch('q');
      await vi.runAllTimersAsync();
      const collection = await promise;

      expect(collection.items).toEqual([]);
      expect(v1Idx).toBe(3); // three solve attempts
      expect(warn).toHaveBeenCalledTimes(2); // one log per retry
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('throws the clear csrftoken error only after exhausting attempts', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let v1Calls = 0;
      const fetchStub = vi.fn(async (input: string | URL | Request) => {
        const urlStr = typeof input === 'string' ? input : input.toString();
        if (urlStr.endsWith('/v1')) {
          v1Calls++;
          return missingCsrf();
        }
        return new Response(endPage, { status: 200 });
      });

      const provider = new PinterestProvider({
        byparrUrl: BYPARR,
        fetch: fetchStub as unknown as typeof fetch,
      });

      const promise = provider.fetch('q');
      const assertion = expect(promise).rejects.toThrow(/csrftoken cookie missing/);
      await vi.runAllTimersAsync();
      await assertion;
      expect(v1Calls).toBe(3); // exactly SESSION_MAX_ATTEMPTS attempts
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
