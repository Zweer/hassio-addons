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
   * Join bullet lines into a single message that fits `MAX_MESSAGE`. When the
   * full list would overflow, keep whole lines up to the cap and append a
   * truncation marker rather than silently dropping content mid-line.
   */
  private capSummary(lines: string[]): string {
    const full = lines.join('\n');
    if (full.length <= MAX_MESSAGE) return full;

    const marker = '… (troncato)';
    const budget = MAX_MESSAGE - marker.length - 1; // room for "\n" + marker
    const kept: string[] = [];
    let used = 0;
    for (const line of lines) {
      const addition = kept.length === 0 ? line.length : line.length + 1; // +1 for "\n"
      if (used + addition > budget) break;
      kept.push(line);
      used += addition;
    }
    // Guarantee progress even if the very first line is pathologically long.
    if (kept.length === 0) return full.slice(0, MAX_MESSAGE);
    return `${kept.join('\n')}\n${marker}`;
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
    // Each query and each error is its own bullet line (not comma-joined) so
    // the summary reads as a list rather than a wall of text.
    const lines: string[] = [];
    if (totalNew === 0) {
      lines.push('📭 Social Archiver: nessuna novità.');
    } else {
      const bySource = new Map<string, SourceResult[]>();
      for (const r of withNew) {
        const list = bySource.get(r.source) ?? [];
        list.push(r);
        bySource.set(r.source, list);
      }
      lines.push(`📥 Social Archiver — ${totalNew} nuovi elementi`);
      for (const [source, list] of bySource) {
        const count = list.reduce((s, r) => s + r.newItems, 0);
        lines.push(`${sourceLabel(source)} — ${count}:`);
        for (const r of list) {
          lines.push(`• ${r.target} (${r.newItems})`);
        }
      }
    }
    if (errored.length > 0) {
      lines.push('⚠️ Errori:');
      for (const r of errored) {
        lines.push(`• ${sourceLabel(r.source)}/${r.target} (${r.error})`);
      }
    }

    const messageId = await this.postMessage(this.capSummary(lines));

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
