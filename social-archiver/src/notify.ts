import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { SourceResult } from './types.js';

const MAX_MESSAGE = 1900; // stay under Discord's 2000-char limit
// Discord accepts at most 10 attachments per message. Attach a few sample
// previews to the summary message itself (option 4) rather than opening a
// thread per query — a webhook cannot create threads in a normal text channel,
// which made the old per-query thread posts fail with HTTP 400.
const MAX_SUMMARY_PREVIEWS = 10;

/** Human label for a source key. */
function sourceLabel(source: string): string {
  if (source === 'instagram') return 'Instagram';
  if (source === 'pinterest') return 'Pinterest';
  return source;
}

export class DiscordNotifier {
  constructor(private readonly webhookUrl: string) {}

  /**
   * Post the summary message, optionally with a few image previews attached to
   * the SAME message. Uses multipart when there are previews, plain JSON
   * otherwise. One request, no threads — so it works in any channel type.
   */
  private async postSummary(content: string, imagePaths: string[]): Promise<void> {
    const text = content.slice(0, MAX_MESSAGE);

    if (imagePaths.length === 0) {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) console.warn(`[notify] summary post failed: HTTP ${res.status}`);
      return;
    }

    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: text }));
    let attached = 0;
    for (let i = 0; i < imagePaths.length; i++) {
      try {
        const bytes = await readFile(imagePaths[i]);
        form.append(
          `files[${attached}]`,
          new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
          basename(imagePaths[i]),
        );
        attached++;
      } catch {
        // preview file missing — skip it
      }
    }
    // If every preview file was unreadable, fall back to a plain text post.
    if (attached === 0) {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) console.warn(`[notify] summary post failed: HTTP ${res.status}`);
      return;
    }

    const res = await fetch(this.webhookUrl, { method: 'POST', body: form });
    if (!res.ok) console.warn(`[notify] summary post failed: HTTP ${res.status}`);
  }

  /**
   * Pick up to `MAX_SUMMARY_PREVIEWS` preview images across all targets,
   * round-robin so no single target dominates the sample.
   */
  private pickPreviews(withNew: SourceResult[]): string[] {
    const picked: string[] = [];
    for (let round = 0; picked.length < MAX_SUMMARY_PREVIEWS; round++) {
      let addedThisRound = false;
      for (const r of withNew) {
        if (r.previews.length > round) {
          picked.push(r.previews[round]);
          addedThisRound = true;
          if (picked.length >= MAX_SUMMARY_PREVIEWS) break;
        }
      }
      if (!addedThisRound) break; // no target has more previews at this depth
    }
    return picked;
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
   * - Otherwise → ONE summary message grouped by source, with a few sample
   *   preview images attached to that same message (no threads).
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

    // A few sample previews attached to the summary message itself.
    const previews = this.pickPreviews(withNew);
    await this.postSummary(this.capSummary(lines), previews);
  }
}
