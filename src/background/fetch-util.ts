/** Shared helpers for the service-worker fetch paths (CSS, images). */

/** Streams the body chunk by chunk, cancelling the reader and throwing as soon as it exceeds maxBytes. */
export async function readCapped(
  res: Response, maxBytes: number, tooLarge: string, onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(tooLarge);
    }
    onChunk(value);
  }
}

/** Promise cache keyed by URL: LRU, failed loads are dropped. */
export function createLruLoader<T>(size: number, load: (url: string) => Promise<T>) {
  const cache = new Map<string, Promise<T>>();
  return {
    get(url: string): Promise<T> {
      let p = cache.get(url);
      if (p) {
        cache.delete(url); // most recently used goes last
        cache.set(url, p);
        return p;
      }
      p = load(url);
      cache.set(url, p);
      if (cache.size > size) cache.delete(cache.keys().next().value!);
      const mine = p;
      mine.catch(() => { if (cache.get(url) === mine) cache.delete(url); });
      return p;
    },
    reset(): void { cache.clear(); },
  };
}

/** An Error for anything but http/https URLs; null when the URL is fine. */
export function schemeError(url: string): Error | null {
  let protocol: string;
  try { protocol = new URL(url).protocol; } catch { return new Error('invalid url'); }
  return protocol === 'http:' || protocol === 'https:' ? null : new Error('unsupported scheme');
}
