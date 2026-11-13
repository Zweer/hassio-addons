import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordNotifier } from '../src/notify.js';
import type { SourceResult } from '../src/types.js';

const WEBHOOK = 'https://discord.local/webhook/abc';

function result(partial: Partial<SourceResult> & Pick<SourceResult, 'source' | 'target'>): SourceResult {
  return {
    bootstrap: false,
    newItems: 0,
    newMediaFiles: 0,
    previews: [],
    ...partial,
  };
}

interface Captured {
  content: string;
  /** Number of `files[n]` parts when the POST was multipart, else 0. */
  attachments: number;
}

/**
 * Stub global fetch. Captures every POST to the webhook — both plain-JSON
 * summaries and multipart summaries (with preview attachments) — recording the
 * `content` text and how many files were attached.
 */
function stubFetch() {
  const posts: Captured[] = [];
  const stub = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body;
    if (body instanceof FormData) {
      const payload = JSON.parse(String(body.get('payload_json') ?? '{}')) as { content?: string };
      let attachments = 0;
      for (const key of (body as FormData).keys()) {
        if (key.startsWith('files[')) attachments++;
      }
      posts.push({ content: payload.content ?? '', attachments });
    } else {
      const parsed = JSON.parse(String(body ?? '{}')) as { content?: string };
      posts.push({ content: parsed.content ?? '', attachments: 0 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', stub);
  return { posts, contents: () => posts.map((p) => p.content) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiscordNotifier.sendSummary formatting', () => {
  it('renders each query as its own bullet line, grouped by source', async () => {
    const { contents } = stubFetch();
    const notifier = new DiscordNotifier(WEBHOOK);

    await notifier.sendSummary(
      [
        result({ source: 'pinterest', target: 'corporate chic outfit', newItems: 50 }),
        result({ source: 'pinterest', target: 'power dressing woman', newItems: 48 }),
      ],
      false,
    );

    const summaries = contents();
    expect(summaries).toHaveLength(1);
    const lines = summaries[0].split('\n');
    expect(lines[0]).toBe('📥 Social Archiver — 98 nuovi elementi');
    expect(lines).toContain('Pinterest — 98:');
    expect(lines).toContain('• corporate chic outfit (50)');
    expect(lines).toContain('• power dressing woman (48)');
    // No comma-joined wall-of-text line.
    expect(summaries[0]).not.toContain('(50), ');
  });

  it('renders each error as its own bullet line under ⚠️ Errori:', async () => {
    const { contents } = stubFetch();
    const notifier = new DiscordNotifier(WEBHOOK);

    await notifier.sendSummary(
      [
        result({ source: 'pinterest', target: 'office outfit', newItems: 12 }),
        result({
          source: 'pinterest',
          target: 'short skirt office outfit',
          error: '[pinterest] csrftoken cookie missing from the Byparr session.',
        }),
      ],
      false,
    );

    const lines = contents()[0].split('\n');
    expect(lines).toContain('⚠️ Errori:');
    expect(lines).toContain(
      '• Pinterest/short skirt office outfit ([pinterest] csrftoken cookie missing from the Byparr session.)',
    );
    // The error list is not comma-joined on one line.
    const errorLines = lines.filter((l) => l.startsWith('• Pinterest/'));
    expect(errorLines).toHaveLength(1);
  });

  it('keeps the summary within the Discord length cap, marking truncation', async () => {
    const { contents } = stubFetch();
    const notifier = new DiscordNotifier(WEBHOOK);

    const many: SourceResult[] = Array.from({ length: 200 }, (_, i) =>
      result({ source: 'pinterest', target: `query number ${i} with a fairly long name`, newItems: i + 1 }),
    );

    await notifier.sendSummary(many, false);

    const summary = contents()[0];
    expect(summary.length).toBeLessThanOrEqual(1900);
    expect(summary).toContain('… (troncato)');
    // Whole lines are kept (no line cut mid-way): last content line is a bullet.
    const lines = summary.split('\n');
    expect(lines[lines.length - 1]).toBe('… (troncato)');
    expect(lines[lines.length - 2].startsWith('• ')).toBe(true);
  });

  it('attaches at most 10 real previews to a SINGLE summary post (no threads)', async () => {
    const { posts } = stubFetch();
    const notifier = new DiscordNotifier(WEBHOOK);

    // Create real temp files so readFile succeeds and attachments are counted.
    const dir = await mkdtemp(join(tmpdir(), 'notify-prev-'));
    const mk = async (n: number, prefix: string) => {
      const paths: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = join(dir, `${prefix}${i}.jpg`);
        await writeFile(p, new Uint8Array([0xff, 0xd8, 0xff]));
        paths.push(p);
      }
      return paths;
    };
    const a = await mk(8, 'a');
    const b = await mk(8, 'b');

    await notifier.sendSummary(
      [
        result({ source: 'pinterest', target: 'alpha', newItems: 8, previews: a }),
        result({ source: 'pinterest', target: 'beta', newItems: 8, previews: b }),
      ],
      false,
    );

    await rm(dir, { recursive: true, force: true });

    // Exactly ONE request (no per-query threads), capped at 10 attachments.
    expect(posts).toHaveLength(1);
    expect(posts[0].attachments).toBe(10);
    expect(posts[0].content).toContain('📥 Social Archiver — 16 nuovi elementi');
  });

  it('posts a single plain-JSON message when there are no previews', async () => {
    const { posts } = stubFetch();
    const notifier = new DiscordNotifier(WEBHOOK);

    await notifier.sendSummary(
      [result({ source: 'pinterest', target: 'alpha', newItems: 3 })],
      false,
    );

    expect(posts).toHaveLength(1);
    expect(posts[0].attachments).toBe(0);
  });
});
