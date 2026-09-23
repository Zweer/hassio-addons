/**
 * Source-agnostic types for the archiver. Any provider (StoryNavigation today,
 * a future browser userscript tomorrow) yields these shapes, so the
 * orchestration / storage / notification code never depends on the source.
 */

export type MediaKind = 'image' | 'video';

/** A single downloadable media file belonging to a post. */
export interface IngestMedia {
  kind: MediaKind;
  /**
   * Lazily fetch the raw bytes. Providers implement this so that signed,
   * expiring URLs are only resolved at download time (never persisted).
   */
  download: () => Promise<Uint8Array>;
}

/** A post to archive, independent of where it came from. */
export interface IngestPost {
  /** Instagram short code, unique per post. */
  id: string;
  type: 'image' | 'video' | 'sidecar';
  /** ISO-8601 timestamp of creation. */
  createdTime: string;
  caption: string;
  likesCount: number;
  commentsCount: number;
  /** Ordered media files (1 for image/video, N for sidecar). */
  media: IngestMedia[];
  /** Where this post came from, recorded in metadata. */
  source: string;
}

/** A data source that yields posts for a given username. */
export interface IngestProvider {
  readonly name: string;
  listPosts(userName: string): Promise<IngestPost[]>;
}

/** Per-account outcome of an archive pass, used for the Discord summary. */
export interface AccountResult {
  userName: string;
  bootstrap: boolean;
  newPosts: number;
  newMediaFiles: number;
  /** Preview thumbnails (absolute paths) for the notifier, newest first. */
  previews: string[];
  error?: string;
}
