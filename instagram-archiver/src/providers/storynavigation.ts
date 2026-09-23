import {
  type Post,
  StoryNavigationClient,
} from '@zweer/storynavigation-client';
import type { IngestMedia, IngestPost, IngestProvider } from '../types.js';

const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

/**
 * Convert StoryNavigation's human date ("26 June 2026 18:57:05") to ISO-8601
 * ("2026-06-26T18:57:05"). Falls back to the raw string if it doesn't parse.
 */
export function toIso(human: string): string {
  const m = human.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  if (!m) return human;
  const [, day, monthName, year, time] = m;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return human;
  return `${year}-${month}-${day.padStart(2, '0')}T${time}`;
}

/** Build the ordered media list for a post, with lazy byte downloads. */
function mediaFor(client: StoryNavigationClient, post: Post): IngestMedia[] {
  switch (post.type) {
    case 'image':
      return [{ kind: 'image', download: () => client.downloadImage(post.thumbnailUrl) }];
    case 'video': {
      if (!post.videoUrl) {
        // Defensive: a video post without a videoUrl — fall back to the cover.
        return [{ kind: 'image', download: () => client.downloadImage(post.thumbnailUrl) }];
      }
      const videoUrl = post.videoUrl;
      return [{ kind: 'video', download: () => client.downloadVideo(videoUrl) }];
    }
    case 'sidecar':
      return post.sidecarItems.map((slide) => ({
        kind: 'image' as const,
        download: () => client.downloadImage(slide.display_url),
      }));
    default:
      return [];
  }
}

export class StoryNavigationProvider implements IngestProvider {
  readonly name = 'storynavigation';
  private readonly client: StoryNavigationClient;

  constructor(options: { maxDownloadBytes?: number } = {}) {
    this.client = new StoryNavigationClient(
      options.maxDownloadBytes !== undefined
        ? { maxDownloadBytes: options.maxDownloadBytes }
        : {},
    );
  }

  async listPosts(userName: string): Promise<IngestPost[]> {
    const posts = await this.client.getUserMedias(userName);
    return posts.map((post) => ({
      id: post.id,
      type: post.type,
      createdTime: toIso(post.createdTime),
      caption: post.caption,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      media: mediaFor(this.client, post),
      source: this.name,
    }));
  }
}
