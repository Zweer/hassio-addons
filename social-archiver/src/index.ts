import { ConfigError, type Config, loadConfig } from './config.js';
import { DiscordNotifier } from './notify.js';
import { InstagramProvider } from './providers/instagram.js';
import { PinterestProvider } from './providers/pinterest.js';
import { Storage } from './storage.js';
import type { SourceResult } from './types.js';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Shared provider wiring (download cap + Byparr) built from the config. */
function providerOptions(config: Config): {
  maxDownloadBytes?: number;
  byparrUrl?: string;
  byparrTimeoutMs?: number;
} {
  const opts: { maxDownloadBytes?: number; byparrUrl?: string; byparrTimeoutMs?: number } = {};
  if (config.maxDownloadBytes !== undefined) opts.maxDownloadBytes = config.maxDownloadBytes;
  if (config.byparrUrl !== undefined) opts.byparrUrl = config.byparrUrl;
  if (config.byparrTimeoutMs !== undefined) opts.byparrTimeoutMs = config.byparrTimeoutMs;
  return opts;
}

// ─── Instagram ───────────────────────────────────────────────────────────────

async function archiveAccount(
  provider: InstagramProvider,
  storage: Storage,
  userName: string,
): Promise<SourceResult> {
  const bootstrap = storage.isBootstrap(userName);
  const result: SourceResult = {
    source: provider.name,
    target: userName,
    bootstrap,
    newItems: 0,
    newMediaFiles: 0,
    previews: [],
  };

  let collection;
  try {
    collection = await provider.fetch(userName);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[instagram:${userName}] fetch failed: ${result.error}`);
    return result;
  }

  console.log(
    `[instagram:${userName}] ${bootstrap ? 'bootstrap' : 'daily'} — ${collection.items.length} post(s)`,
  );

  for (const item of collection.items) {
    if (storage.isAccountItemArchived(userName, item)) continue;
    try {
      const saved = await storage.saveAccountItem(userName, item);
      result.newItems++;
      result.newMediaFiles += saved.mediaCount;
      if (saved.preview) result.previews.push(saved.preview);
      console.log(`[instagram:${userName}] saved ${item.id} (${saved.mediaCount} files)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[instagram:${userName}] failed to save ${item.id}: ${msg}`);
      // keep going; the post has no folder, so it'll be retried next run
    }
  }

  return result;
}

async function runInstagram(
  config: Config,
  storage: Storage,
  results: SourceResult[],
): Promise<void> {
  const accounts = config.instagram.accounts;
  if (accounts.length === 0) {
    console.log('[instagram] no accounts configured — skipping.');
    return;
  }
  console.log(`[instagram] archiving ${accounts.length} account(s)`);
  const provider = new InstagramProvider(providerOptions(config));
  for (const userName of accounts) {
    results.push(await archiveAccount(provider, storage, userName));
    if (config.requestDelayMs > 0) await sleep(config.requestDelayMs);
  }
}

// ─── Pinterest ─────────────────────────────────────────────────────────────

/** One queued query in the BFS traversal. */
interface QueryNode {
  query: string;
  /** 1-based depth level (1 = seed). */
  level: number;
  /** 'seed' or the parent query text this was discovered from. */
  from: 'seed' | string;
}

async function archiveQuery(
  provider: PinterestProvider,
  storage: Storage,
  node: QueryNode,
  maxImages: number,
): Promise<{ result: SourceResult; related: string[] }> {
  const result: SourceResult = {
    source: provider.name,
    target: node.query,
    bootstrap: false,
    newItems: 0,
    newMediaFiles: 0,
    previews: [],
  };

  let collection;
  try {
    collection = await provider.fetch(node.query);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[pinterest:${node.query}] fetch failed: ${result.error}`);
    return { result, related: [] };
  }

  // Record provenance + related searches for EVERY visited query, any depth.
  const related = collection.related ?? [];
  await storage.writeQueryMeta({ query: node.query, level: node.level, from: node.from });
  await storage.writeRelatedSearches(node.query, related);

  let saved = 0;
  for (const item of collection.items) {
    if (saved >= maxImages) break;
    // In-memory per-run dedup: the first query to see a pin keeps it.
    if (!storage.claimPin(item.id)) continue;
    if (storage.isQueryItemArchived(node.query, item)) {
      saved++;
      continue;
    }
    try {
      const out = await storage.saveQueryItem(node.query, item);
      result.newItems++;
      result.newMediaFiles += out.mediaCount;
      if (out.preview) result.previews.push(out.preview);
      saved++;
      console.log(`[pinterest:${node.query}] saved ${item.id} (${out.mediaCount} files)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[pinterest:${node.query}] failed to save ${item.id}: ${msg}`);
    }
  }

  return { result, related };
}

async function runPinterest(
  config: Config,
  storage: Storage,
  results: SourceResult[],
): Promise<void> {
  const { queries, depth, maxImages, maxQueries } = config.pinterest;
  if (queries.length === 0) {
    console.log('[pinterest] no queries configured — skipping.');
    return;
  }
  console.log(
    `[pinterest] ${queries.length} seed query(ies), depth=${depth}, max_queries=${maxQueries}, max_images=${maxImages}`,
  );

  const provider = new PinterestProvider({ ...providerOptions(config), maxImages });

  // Seed-first BFS: seeds (in config order) first, then related breadth-first.
  const queue: QueryNode[] = queries.map((q) => ({ query: q, level: 1, from: 'seed' as const }));
  const enqueued = new Set<string>(queries);
  let visited = 0;

  while (queue.length > 0) {
    if (visited >= maxQueries) {
      console.log(`[pinterest] max_queries (${maxQueries}) reached — stopping cleanly.`);
      break;
    }
    const node = queue.shift() as QueryNode;
    visited++;

    const { result, related } = await archiveQuery(provider, storage, node, maxImages);
    results.push(result);

    // Enqueue related searches only if a deeper level is still within `depth`.
    if (node.level < depth) {
      for (const rel of related) {
        if (!enqueued.has(rel)) {
          enqueued.add(rel);
          queue.push({ query: rel, level: node.level + 1, from: node.query });
        }
      }
    }

    if (config.requestDelayMs > 0) await sleep(config.requestDelayMs);
  }

  console.log(`[pinterest] visited ${visited} query(ies).`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[social-archiver] Config error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const hasInstagram = config.instagram.accounts.length > 0;
  const hasPinterest = config.pinterest.queries.length > 0;
  if (!hasInstagram && !hasPinterest) {
    console.warn('[social-archiver] Nothing configured (no accounts, no queries) — nothing to do.');
    return;
  }

  console.log(`[social-archiver] Output → ${config.outputDir}`);

  const storage = new Storage({
    outputDir: config.outputDir,
    requestDelayMs: config.requestDelayMs,
  });

  const results: SourceResult[] = [];
  await runInstagram(config, storage, results);
  await runPinterest(config, storage, results);

  const totalNew = results.reduce((s, r) => s + r.newItems, 0);
  const totalFiles = results.reduce((s, r) => s + r.newMediaFiles, 0);
  console.log(`[social-archiver] Done — ${totalNew} new item(s), ${totalFiles} file(s).`);

  if (config.discordWebhookUrl) {
    try {
      const notifier = new DiscordNotifier(config.discordWebhookUrl);
      await notifier.sendSummary(results, config.notifyEmpty);
    } catch (err) {
      console.error(
        `[social-archiver] Discord notify failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

main().catch((err) => {
  console.error('[social-archiver] Fatal:', err);
  process.exit(1);
});
