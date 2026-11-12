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

/**
 * Stub global fetch. Captures the JSON `content` posted to the summary webhook
 * (the first POST, with `wait=true`) and returns a message id so threading is
 * exercised but preview posts (no previews here) are skipped.
 */
function stubFetch() {
  const summaries: string[] = [];
  const stub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    if (urlStr.includes('wait=true')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { content?: string };
      summaries.push(body.content ?? '');
      return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', stub);
  return { summaries };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DiscordNotifier.sendSummary formatting', () => {
  it('renders each query as its own bullet line, grouped by source', async () => {
    const { summaries } = stubFetch();
    const notifier = new DiscordNotifier(WEBHOOK);

    await notifier.sendSummary(
      [
        result({ source: 'pinterest', target: 'corporate chic outfit', newItems: 50 }),
        result({ source: 'pinterest', target: 'power dressing woman', newItems: 48 }),
      ],
      false,
    );

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
    const { summaries } = stubFetch();
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

    const lines = summaries[0].split('\n');
    expect(lines).toContain('⚠️ Errori:');
    expect(lines).toContain(
      '• Pinterest/short skirt office outfit ([pinterest] csrftoken cookie missing from the Byparr session.)',
    );
    // The error list is not comma-joined on one line.
    const errorLines = lines.filter((l) => l.startsWith('• Pinterest/'));
    expect(errorLines).toHaveLength(1);
  });

  it('keeps the summary within the Discord length cap, marking truncation', async () => {
    const { summaries } = stubFetch();
    const notifier = new DiscordNotifier(WEBHOOK);

    const many: SourceResult[] = Array.from({ length: 200 }, (_, i) =>
      result({ source: 'pinterest', target: `query number ${i} with a fairly long name`, newItems: i + 1 }),
    );

    await notifier.sendSummary(many, false);

    expect(summaries[0].length).toBeLessThanOrEqual(1900);
    expect(summaries[0]).toContain('… (troncato)');
    // Whole lines are kept (no line cut mid-way): last content line is a bullet.
    const lines = summaries[0].split('\n');
    expect(lines[lines.length - 1]).toBe('… (troncato)');
    expect(lines[lines.length - 2].startsWith('• ')).toBe(true);
  });
});
