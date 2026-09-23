import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AccountResult } from './types.js';

const MAX_MESSAGE = 1900; // stay under Discord's 2000-char limit
const MAX_PREVIEWS_PER_ACCOUNT = 4; // avoid huge uploads

interface DiscordMessageResponse {
  id: string;
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
   * Send the run summary.
   * - Bootstrap runs → a single terse summary message (no previews).
   * - Daily runs with new posts → summary + a thread with one message per
   *   account, showing preview thumbnails.
   */
  async sendSummary(results: AccountResult[], notifyEmpty: boolean): Promise<void> {
    const withNew = results.filter((r) => r.newPosts > 0);
    const errored = results.filter((r) => r.error);
    const totalNew = withNew.reduce((sum, r) => sum + r.newPosts, 0);

    if (totalNew === 0 && errored.length === 0 && !notifyEmpty) {
      return; // silent
    }

    const anyBootstrap = results.some((r) => r.bootstrap && r.newPosts > 0);

    // ─── Summary message ───
    let summary: string;
    if (totalNew === 0) {
      summary = '📭 Instagram Archiver: nessuna novità.';
    } else if (anyBootstrap) {
      const parts = withNew.map((r) => `${r.userName} (${r.newPosts})`);
      summary = `📦 Instagram Archiver — archivio inizializzato: ${totalNew} post — ${parts.join(', ')}`;
    } else {
      const parts = withNew.map((r) => `${r.userName} (${r.newPosts})`);
      summary = `📥 Instagram Archiver — ${totalNew} nuovi post: ${parts.join(', ')}`;
    }
    if (errored.length > 0) {
      summary += `\n⚠️ Errori: ${errored.map((r) => `${r.userName} (${r.error})`).join(', ')}`;
    }

    const messageId = await this.postMessage(summary);

    // ─── Per-account previews in a thread (daily, non-bootstrap only) ───
    if (!anyBootstrap && messageId && withNew.length > 0) {
      for (const r of withNew) {
        const previews = r.previews.slice(0, MAX_PREVIEWS_PER_ACCOUNT);
        const more = r.newPosts > previews.length ? ` (+${r.newPosts - previews.length})` : '';
        await this.postToThread(
          messageId,
          `**${r.userName}** — ${r.newPosts} nuovi post${more}`,
          previews,
        );
      }
    }
  }
}
