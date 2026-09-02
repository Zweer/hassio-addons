/**
 * Download a post's media into its own folder.
 * Folder layout (per account):
 *   <accountDir>/<YYYY-MM-DD>_<shortcode>/01.jpg, 02.jpg, ..., caption.txt
 *
 * A post is considered "already archived" if its folder already exists — this
 * is the source of truth for anti-duplication (no DB needed).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Post } from './instagram.js';
import * as log from './notify.js';
import { safeName } from './util.js';

/** Build the folder name for a post: `YYYY-MM-DD_shortcode`. */
export function postFolderName(post: Post): string {
  const date = new Date(post.takenAt * 1000).toISOString().slice(0, 10);
  return `${date}_${safeName(post.shortcode)}`;
}

/** Whether the post's folder already exists (i.e. already archived). */
export async function postExists(accountDir: string, post: Post): Promise<boolean> {
  const dir = path.join(accountDir, postFolderName(post));
  try {
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

/**
 * Download all images of a post plus its caption.
 * Writes atomically-ish: downloads into a temp dir then renames, so a partial
 * download never leaves a "complete-looking" folder behind.
 * Returns true if downloaded, false if skipped (already exists).
 */
export async function downloadPost(accountDir: string, post: Post): Promise<boolean> {
  const folder = postFolderName(post);
  const finalDir = path.join(accountDir, folder);
  const tmpDir = path.join(accountDir, `.tmp_${folder}`);

  if (await postExists(accountDir, post)) return false;

  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    let index = 1;
    for (const img of post.images) {
      const buf = await fetchBuffer(img.url);
      const fileName = String(index).padStart(2, '0') + '.jpg';
      await fs.writeFile(path.join(tmpDir, fileName), buf);
      index += 1;
    }

    const captionLines = [
      `shortcode: ${post.shortcode}`,
      `url: https://www.instagram.com/p/${post.shortcode}/`,
      `date: ${new Date(post.takenAt * 1000).toISOString()}`,
      '',
      post.caption,
    ];
    await fs.writeFile(path.join(tmpDir, 'caption.txt'), captionLines.join('\n'), 'utf-8');

    await fs.rename(tmpDir, finalDir);
    return true;
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    log.warn(`Failed to download post ${post.shortcode}: ${(err as Error).message}`);
    throw err;
  }
}
