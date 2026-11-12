import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { SourceResult } from './types.js';

const MAX_MESSAGE = 1900; // stay under Discord's 2000-char limit
const MAX_PREVIEWS_PER_TARGET = 4; // avoid huge uploads

interface DiscordMessageResponse {
  id: string;
}

/** Human label for a source key. */
function sourceLabel(source: string): string {
  if (source === 'instagram') return 'Instagram';
  if (source === 'pinterest') return 'Pinterest';
  return source;
}

export class DiscordNotifier {
  constructor(private readonly webhookUrl: string) {}

  /** Post a plain message. Returns the created message id (for threading). */
  private async postMessage(content: string): Promise<string | undefined> {
    // wait=true so the response includes the message id.
    const url = this.appendQuery(this.webhookUrl, 'wait=true');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, MAX_MESSAGE) }),
    });
    if (!res.ok) {
      console.warn(`[notify] summary post failed: HTTP ${res.status}`);
      return undefined;
    }
    const body = (await res.json()) as DiscordMessageResponse;
    return body.id;
  }

  /** Post a message with image attachments into a thread. */
  private async postToThread(
    threadId: string,
    content: string,
    imagePaths: string[],
  ): Promise<void> {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: content.slice(0, MAX_MESSAGE) }));
    for (let i = 0; i < imagePaths.length; i++) {
      try {
        const bytes = await readFile(imagePaths[i]);
        form.append(
          `files[${i}]`,
          new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
          basename(imagePaths[i]),
        );
      } catch {
        // preview file missing — skip it
      }
    }
    const url = this.appendQuery(this.webhookUrl, `thread_id=${encodeURIComponent(threadId)}`);
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) {
      console.warn(`[notify] thread post failed: HTTP ${res.status}`);
    }
  }

  private appendQuery(url: string, query: string): string {
    return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
  }

  /**
   * Send the run summary across all sources.
   * - Nothing new and no errors → silent (unless `notifyEmpty`).
   * - Otherwise → one summary message grouped by source, plus a preview thread
   *   per target that produced new items.
   */
  async sendSummary(results: SourceResult[], notifyEmpty: boolean): Promise<void> {
    const withNew = results.filter((r) => r.newItems > 0);
    const errored = results.filter((r) => r.error);
    const totalNew = withNew.reduce((sum, r) => sum + r.newItems, 0);

    if (totalNew === 0 && errored.length === 0 && !notifyEmpty) {
      return; // silent
    }

    // ─── Summary message, grouped by source ───
    let summary: string;
    if (totalNew === 0) {
      summary = '📭 Social Archiver: nessuna novità.';
    } else {
      const bySource = new Map<string, SourceResult[]>();
      for (const r of withNew) {
        const list = bySource.get(r.source) ?? [];
        list.push(r);
        bySource.set(r.source, list);
      }
      const groups: string[] = [];
      for (const [source, list] of bySource) {
        const count = list.reduce((s, r) => s + r.newItems, 0);
        const parts = list.map((r) => `${r.target} (${r.newItems})`);
        groups.push(`${sourceLabel(source)} — ${count}: ${parts.join(', ')}`);
      }
      summary = `📥 Social Archiver — ${totalNew} nuovi elementi\n${groups.join('\n')}`;
    }
    if (errored.length > 0) {
      summary += `\n⚠️ Errori: ${errored
        .map((r) => `${sourceLabel(r.source)}/${r.target} (${r.error})`)
        .join(', ')}`;
    }

    const messageId = await this.postMessage(summary);

    // ─── Per-target previews in a thread ───
    if (messageId && withNew.length > 0) {
      for (const r of withNew) {
        const previews = r.previews.slice(0, MAX_PREVIEWS_PER_TARGET);
        if (previews.length === 0) continue;
        const more = r.newItems > previews.length ? ` (+${r.newItems - previews.length})` : '';
        await this.postToThread(
          messageId,
          `**${sourceLabel(r.source)} / ${r.target}** — ${r.newItems} nuovi${more}`,
          previews,
        );
      }
    }
  }
}
