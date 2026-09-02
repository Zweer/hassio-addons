/** Small timing/utility helpers to make automation look more human. */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Random delay between min and max milliseconds. When `randomize` is false,
 * returns a short fixed delay (still non-zero to avoid hammering).
 */
export function humanDelay(randomize: boolean, minMs = 800, maxMs = 2500): Promise<void> {
  if (!randomize) return sleep(500);
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return sleep(ms);
}

/** Sanitize a string so it is safe to use as a folder/file name. */
export function safeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}
