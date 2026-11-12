/**
 * Source-agnostic types for the multi-source archiver. Every provider
 * (StoryNavigation/Instagram today, Pinterest tomorrow) yields these shapes, so
 * the orchestration / storage / notification code never depends on the source.
 *
 * The abstraction generalizes instagram-archiver's account→post model into a
 * collection→item model: a provider takes one `target` (a username for
 * Instagram, a search query for Pinterest) and returns one `IngestCollection`.
 */

export type MediaKind = 'image' | 'video';

/** A single downloadable media file belonging to an item. */
export interface IngestMedia {
  kind: MediaKind;
  /**
   * Lazily fetch the raw bytes. Providers implement this so that signed,
   * expiring URLs are only resolved at download time (never persisted).
   */
  download: () => Promise<Uint8Array>;
}

/** A single item to archive (an Instagram post or a Pinterest pin). */
export interface IngestItem {
  /** Unique per source: Instagram short code | Pinterest pin id. */
  id: string;
  type: 'image' | 'video' | 'sidecar';
  /** ISO-8601 timestamp of creation. */
  createdTime: string;
  caption: string;
  /**
   * Flexible stat map. Instagram fills `{ likes, comments }`; Pinterest fills
   * `{ saves }`. Written verbatim into metadata.yaml.
   */
  stats: Record<string, number>;
  /**
   * Canonical URL of the item, PROVIDED BY THE PROVIDER (not hardcoded in
   * storage). Instagram: https://www.instagram.com/p/<id>/ ;
   * Pinterest: https://www.pinterest.com/pin/<pinid>/ .
   */
  url: string;
  /** Ordered media files (1 for image/video, N for sidecar). */
  media: IngestMedia[];
  /** Where this item came from, recorded in metadata. */
  source: string;
}

/**
 * The result of one unit of work (one account, or one query). `related` carries
 * Pinterest's related searches — always populated (possibly empty) for
 * Pinterest, undefined for Instagram.
 */
export interface IngestCollection {
  items: IngestItem[];
  related?: string[];
}

/**
 * A data source. `kind` tells the orchestrator how to treat the target:
 * `account` (Instagram username) or `query` (Pinterest search string).
 */
export interface IngestProvider {
  readonly name: string;
  readonly kind: 'account' | 'query';
  fetch(target: string): Promise<IngestCollection>;
}

/** Per-target outcome of an archive pass, used for the Discord summary. */
export interface SourceResult {
  /** Which provider produced this result (e.g. 'instagram', 'pinterest'). */
  source: string;
  /** The account or query this result is for. */
  target: string;
  bootstrap: boolean;
  newItems: number;
  newMediaFiles: number;
  /** Preview thumbnails (absolute paths) for the notifier, newest first. */
  previews: string[];
  error?: string;
}
