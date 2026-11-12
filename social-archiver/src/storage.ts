import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IngestItem, IngestMedia } from './types.js';

/** Pad a 1-based index to 3 digits: 1 → "001". */
function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** Extension for a media kind (jpg/mp4). */
function extFor(kind: IngestMedia['kind']): string {
  return kind === 'video' ? 'mp4' : 'jpg';
}

/** Date prefix (YYYY-MM-DD) from an ISO-ish timestamp, safe fallback to today. */
function datePrefix(isoish: string): string {
  const m = isoish.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return new Date().toISOString().slice(0, 10);
}

/** Minimal YAML-safe double-quoted scalar. */
function yamlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** Render a multi-line caption as a YAML block scalar. */
function yamlCaption(caption: string): string {
  if (caption === '') return '""';
  const lines = caption.split('\n').map((l) => `  ${l}`);
  return `|\n${lines.join('\n')}`;
}

/**
 * Filesystem-safe slug of an arbitrary query string. Lowercases, replaces any
 * run of non-alphanumeric characters with a single hyphen, trims hyphens, and
 * caps length. Falls back to "query" when nothing usable remains.
 */
export function slugify(query: string): string {
  const slug = query
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'query';
}

interface WrittenMedia {
  file: string;
  kind: IngestMedia['kind'];
}

/** Render the flexible stats map as sorted YAML scalar lines. */
function statsLines(stats: Record<string, number>): string[] {
  const keys = Object.keys(stats).sort();
  if (keys.length === 0) return ['stats: {}'];
  return ['stats:', ...keys.map((k) => `  ${k}: ${stats[k]}`)];
}

function buildMetadataYaml(item: IngestItem, written: WrittenMedia[]): string {
  const lines: string[] = [
    `id: ${yamlString(item.id)}`,
    `type: ${item.type}`,
    `url: ${yamlString(item.url)}`,
    `created_time: ${yamlString(item.createdTime)}`,
    `caption: ${yamlCaption(item.caption)}`,
    ...statsLines(item.stats),
    'media:',
    ...written.flatMap((w) => [`  - file: ${yamlString(w.file)}`, `    kind: ${w.kind}`]),
    `downloaded_at: ${yamlString(new Date().toISOString())}`,
    `source: ${yamlString(item.source)}`,
  ];
  return `${lines.join('\n')}\n`;
}

/** Provenance of a Pinterest query, written into query.yaml. */
export interface QueryProvenance {
  /** The query text. */
  query: string;
  /** Depth level at which this query was visited (1 = seed). */
  level: number;
  /** A seed query, or derived from a parent related search. */
  from: 'seed' | string;
}

function buildQueryYaml(p: QueryProvenance): string {
  const lines: string[] = [
    `query: ${yamlString(p.query)}`,
    `depth: ${p.level}`,
    p.from === 'seed' ? 'provenance: seed' : `provenance:\n  from: ${yamlString(p.from)}`,
    `timestamp: ${yamlString(new Date().toISOString())}`,
  ];
  return `${lines.join('\n')}\n`;
}

function buildRelatedSearchesYaml(related: string[]): string {
  if (related.length === 0) return 'related_searches: []\n';
  const lines = ['related_searches:', ...related.map((r) => `  - ${yamlString(r)}`)];
  return `${lines.join('\n')}\n`;
}

export interface StorageOptions {
  outputDir: string;
  /** Delay between individual media downloads (ms). */
  requestDelayMs: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export interface SavedItem {
  folder: string;
  mediaCount: number;
  /** Absolute path to the first image (for Discord preview), if any. */
  preview?: string;
}

/**
 * Shared on-disk archive. Two layouts:
 * - Instagram: instagram/<username>/<YYYY-MM-DD>_<postid>/
 * - Pinterest: pinterest/<query-slug>/<pinid>/  (+ per-query yaml files)
 *
 * Both share: atomic .partial-then-rename commit, zero-padded 3-digit media
 * filenames, metadata.yaml, and dedup by folder existence.
 */
export class Storage {
  /** In-memory set of Pinterest pin ids seen during the CURRENT run. */
  private readonly seenPins = new Set<string>();

  constructor(private readonly options: StorageOptions) {}

  // ─── Instagram layout ──────────────────────────────────────────────────

  /** Root directory for all Instagram archives. */
  private instagramRoot(): string {
    return join(this.options.outputDir, 'instagram');
  }

  /** Directory for a single Instagram account. */
  accountDir(userName: string): string {
    return join(this.instagramRoot(), userName);
  }

  /** Folder name for a post: "<date>_<id>". */
  private postFolderName(item: IngestItem): string {
    return `${datePrefix(item.createdTime)}_${item.id}`;
  }

  /** True if the account has never been archived (→ bootstrap). */
  isBootstrap(userName: string): boolean {
    return !existsSync(this.accountDir(userName));
  }

  /** True if a post is already fully archived (dedup by folder existence). */
  isAccountItemArchived(userName: string, item: IngestItem): boolean {
    return existsSync(join(this.accountDir(userName), this.postFolderName(item)));
  }

  /** Download + persist an Instagram post. */
  async saveAccountItem(userName: string, item: IngestItem): Promise<SavedItem> {
    const finalFolder = join(this.accountDir(userName), this.postFolderName(item));
    return this.commitItem(finalFolder, item);
  }

  // ─── Pinterest layout ──────────────────────────────────────────────────

  /** Root directory for all Pinterest archives. */
  private pinterestRoot(): string {
    return join(this.options.outputDir, 'pinterest');
  }

  /** Directory for a single Pinterest query. */
  queryDir(query: string): string {
    return join(this.pinterestRoot(), slugify(query));
  }

  /**
   * Record and consult the in-memory per-run dedup set. Returns true if this is
   * the FIRST time the pin id has been seen this run (caller should archive),
   * false if a previous query already claimed it. Seed-first BFS order means
   * the first query to encounter a pin keeps it.
   */
  claimPin(pinId: string): boolean {
    if (this.seenPins.has(pinId)) return false;
    this.seenPins.add(pinId);
    return true;
  }

  /** True if a pin is already archived on disk under this query. */
  isQueryItemArchived(query: string, item: IngestItem): boolean {
    return existsSync(join(this.queryDir(query), item.id));
  }

  /** Download + persist a Pinterest pin under its query folder. */
  async saveQueryItem(query: string, item: IngestItem): Promise<SavedItem> {
    const finalFolder = join(this.queryDir(query), item.id);
    return this.commitItem(finalFolder, item);
  }

  /** Write query.yaml for a visited query (provenance + depth + timestamp). */
  async writeQueryMeta(provenance: QueryProvenance): Promise<void> {
    const dir = this.queryDir(provenance.query);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'query.yaml'), buildQueryYaml(provenance));
  }

  /**
   * Write related_searches.yaml for a visited query. Always called for every
   * visited query, regardless of depth.
   */
  async writeRelatedSearches(query: string, related: string[]): Promise<void> {
    const dir = this.queryDir(query);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'related_searches.yaml'), buildRelatedSearchesYaml(related));
  }

  // ─── Shared commit ───────────────────────────────────────────────────────

  /**
   * Download a item's media + write metadata.yaml into a temp folder, then
   * rename it to the final folder. Downloads happen immediately (signed URLs
   * expire) and are serialized with a delay. The temp-then-rename commit means
   * a partially-downloaded item is never mistaken for "already archived".
   */
  private async commitItem(finalFolder: string, item: IngestItem): Promise<SavedItem> {
    const tmpFolder = `${finalFolder}.partial`;
    await mkdir(tmpFolder, { recursive: true });

    const written: WrittenMedia[] = [];
    let preview: string | undefined;

    for (let i = 0; i < item.media.length; i++) {
      const media = item.media[i];
      const bytes = await media.download();
      const file = `${pad3(i + 1)}.${extFor(media.kind)}`;
      await writeFile(join(tmpFolder, file), bytes);
      written.push({ file, kind: media.kind });
      if (!preview && media.kind === 'image') preview = join(finalFolder, file);
      if (this.options.requestDelayMs > 0 && i < item.media.length - 1) {
        await sleep(this.options.requestDelayMs);
      }
    }

    await writeFile(join(tmpFolder, 'metadata.yaml'), buildMetadataYaml(item, written));

    // Atomic-ish commit: rename temp → final.
    await rename(tmpFolder, finalFolder);

    const result: SavedItem = { folder: finalFolder, mediaCount: written.length };
    if (preview) result.preview = preview;
    return result;
  }
}
