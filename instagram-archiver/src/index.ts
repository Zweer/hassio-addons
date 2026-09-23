import { loadConfig } from './config.js';
import { DiscordNotifier } from './notify.js';
import { StoryNavigationProvider } from './providers/storynavigation.js';
import { Storage } from './storage.js';
import type { AccountResult, IngestProvider } from './types.js';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function archiveAccount(
  provider: IngestProvider,
  storage: Storage,
  userName: string,
): Promise<AccountResult> {
  const bootstrap = storage.isBootstrap(userName);
  const result: AccountResult = {
    userName,
    bootstrap,
    newPosts: 0,
    newMediaFiles: 0,
    previews: [],
  };

  let posts;
  try {
    posts = await provider.listPosts(userName);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[${userName}] list failed: ${result.error}`);
    return result;
  }

  console.log(
    `[${userName}] ${bootstrap ? 'bootstrap' : 'daily'} — ${posts.length} posts from ${provider.name}`,
  );

  for (const post of posts) {
    if (storage.isArchived(userName, post)) continue;
    try {
      const saved = await storage.savePost(userName, post);
      result.newPosts++;
      result.newMediaFiles += saved.mediaCount;
      if (saved.preview) result.previews.push(saved.preview);
      console.log(`[${userName}] saved ${post.id} (${saved.mediaCount} files)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${userName}] failed to save ${post.id}: ${msg}`);
      // keep going; the post has no folder, so it'll be retried next run
    }
  }

  return result;
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.accounts.length === 0) {
    console.warn('[instagram-archiver] No accounts configured — nothing to do.');
    return;
  }

  console.log(
    `[instagram-archiver] Archiving ${config.accounts.length} account(s) → ${config.outputDir}`,
  );

  const provider = new StoryNavigationProvider(
    config.maxDownloadBytes !== undefined
      ? { maxDownloadBytes: config.maxDownloadBytes }
      : {},
  );
  const storage = new Storage({
    outputDir: config.outputDir,
    requestDelayMs: config.requestDelayMs,
  });

  const results: AccountResult[] = [];
  for (const userName of config.accounts) {
    results.push(await archiveAccount(provider, storage, userName));
    if (config.requestDelayMs > 0) await sleep(config.requestDelayMs);
  }

  const totalNew = results.reduce((s, r) => s + r.newPosts, 0);
  const totalFiles = results.reduce((s, r) => s + r.newMediaFiles, 0);
  console.log(
    `[instagram-archiver] Done — ${totalNew} new post(s), ${totalFiles} file(s).`,
  );

  if (config.discordWebhookUrl) {
    try {
      const notifier = new DiscordNotifier(config.discordWebhookUrl);
      await notifier.sendSummary(results, config.notifyEmpty);
    } catch (err) {
      console.error(
        `[instagram-archiver] Discord notify failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

main().catch((err) => {
  console.error('[instagram-archiver] Fatal:', err);
  process.exit(1);
});
