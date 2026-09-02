/**
 * Logging with optional Discord webhook forwarding.
 * Uses the global fetch available in Node 24.
 */

let webhookUrl = '';

export function initNotifier(discordWebhook: string): void {
  webhookUrl = discordWebhook;
}

function ts(): string {
  return new Date().toISOString();
}

export function info(msg: string): void {
  console.log(`[instagram-archive] ${msg}`);
}

export function warn(msg: string): void {
  console.warn(`[instagram-archive] WARN: ${msg}`);
}

export function error(msg: string): void {
  console.error(`[instagram-archive] ERROR: ${msg}`);
}

/**
 * Send a notification to Discord (best-effort — never throws).
 * Also logs to stdout.
 */
export async function notify(msg: string): Promise<void> {
  info(msg);
  if (!webhookUrl) return;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `**[instagram-archive]** ${msg}\n_${ts()}_` }),
    });
    if (!res.ok) {
      warn(`Discord webhook returned ${res.status}`);
    }
  } catch (err) {
    warn(`Failed to send Discord notification: ${(err as Error).message}`);
  }
}
