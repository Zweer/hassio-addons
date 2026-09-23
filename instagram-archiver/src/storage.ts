import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IngestMedia, IngestPost } from './types.js';

/** Pad a 1-based index to 3 digits: 1 → "001". */
function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** Extension for a media kind (StoryNavigation serves jpg/mp4). */
function extFor(kind: IngestMedia['kind']): string {
  return kind === 'video' ? 'mp4' : 'jpg';
}

/** Date prefix (YYYY-MM-DD) from an ISO-ish timestamp, safe fallback to today. */
function datePrefix(isoish: string): string {
  const m = isoish.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return new Date().toISOString().slice(0, 10);
}

/** Folder name for a post: "<date>_<id>". */
export function postFolderName(post: IngestPost): string {
  return `${datePrefix(post.createdTime)}_${post.id}`;
}

/** Minimal YAML-safe double-quoted scalar. */
function yamlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** Render a multi-line caption as a YAML block scalar. */
function yamlCaption(caption: string): string {
  if (caption === '') return '""';
  const lines = caption.split('\n').map((l) => `  ${l}`.replace(/\s+$/, (t) => t));
  return `|\n${lines.join('\n')}`;
}

interface WrittenMedia {
  file: string;
  kind: IngestMedia['kind'];
}

function buildMetadataYaml(post: IngestPost, written: WrittenMedia[]): string {
  const lines: string[] = [
    `id: ${yamlString(post.id)}`,
    `type: ${post.type}`,
    `url: ${yamlString(`https://www.instagram.com/p/${post.id}/`)}`,
    `created_time: ${yamlString(post.createdTime)}`,
    `caption: ${yamlCaption(post.caption)}`,
    `likes_count: ${post.likesCount}`,
    `comments_count: ${post.commentsCount}`,
    'media:',
    ...written.flatMap((w) => [`  - file: ${yamlString(w.file)}`, `    kind: ${w.kind}`]),
    `downloaded_at: ${yamlString(new Date().toISOString())}`,
    `source: ${yamlString(post.source)}`,
  ];
  return `${lines.join('\n')}\n`;
}

export interface StorageOptions {
  outputDir: string;
  /** Delay between individual media downloads (ms). */
  requestDelayMs: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface SavedPost {
  folder: string;
  mediaCount: number;
  /** Absolute path to the first image (for Discord preview), if any. */
  preview?: string;
}

export class Storage {
  constructor(private readonly options: StorageOptions) {}

  /** Directory for an account. */
  accountDir(userName: string): string {
    return join(this.options.outputDir, userName);
  }

  /** True if the account has never been archived (→ bootstrap). */
  isBootstrap(userName: string): boolean {
    return !existsSync(this.accountDir(userName));
  }

  /** True if a post is already fully archived (dedup by folder existence). */
  isArchived(userName: string, post: IngestPost): boolean {
    return existsSync(join(this.accountDir(userName), postFolderName(post)));
  }

  /**
   * Download and persist a post's media + metadata.yaml. Downloads happen
   * immediately (signed URLs expire) and are serialized with a delay to be
   * gentle on the source. Writes into a temp folder then renames, so a
   * partially-downloaded post is never mistaken for "already archived".
   */
  async savePost(userName: string, post: IngestPost): Promise<SavedPost> {
    const finalFolder = join(this.accountDir(userName), postFolderName(post));
    const tmpFolder = `${finalFolder}.partial`;
    await mkdir(tmpFolder, { recursive: true });

    const written: WrittenMedia[] = [];
    let preview: string | undefined;

    for (let i = 0; i < post.media.length; i++) {
      const media = post.media[i];
      const bytes = await media.download();
      const file = `${pad3(i + 1)}.${extFor(media.kind)}`;
      await writeFile(join(tmpFolder, file), bytes);
      written.push({ file, kind: media.kind });
      if (!preview && media.kind === 'image') preview = join(finalFolder, file);
      if (this.options.requestDelayMs > 0 && i < post.media.length - 1) {
        await sleep(this.options.requestDelayMs);
      }
    }

    await writeFile(join(tmpFolder, 'metadata.yaml'), buildMetadataYaml(post, written));

    // Atomic-ish commit: rename temp → final.
    const { rename } = await import('node:fs/promises');
    await rename(tmpFolder, finalFolder);

    const result: SavedPost = { folder: finalFolder, mediaCount: written.length };
    if (preview) result.preview = preview;
    return result;
  }
}
