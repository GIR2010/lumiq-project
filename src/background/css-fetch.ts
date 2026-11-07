const TIMEOUT_MS = 10_000;
/** Largest stylesheet we fetch for a page. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Cached sheets (LRU; failed requests are not cached). */
const CACHE_SIZE = 100;
const cache = new Map<string, Promise<string>>();

export function resetCssCache(): void { cache.clear(); }

function isCss(res: Response): boolean {
  const type = res.headers.get('content-type') ?? '';
  return type.split(';')[0].trim().toLowerCase() === 'text/css';
}

/** Reads the body as UTF-8 (like Response.text()), giving up as soon as it exceeds MAX_BYTES. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('stylesheet too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function load(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: 'omit', signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!isCss(res)) throw new Error(`not CSS: ${res.headers.get('content-type') ?? 'no content-type'}`);
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('stylesheet too large');
    return await readCapped(res);
  } finally {
    clearTimeout(timer);
  }
}

export function fetchCss(url: string): Promise<string> {
  let protocol: string;
  try { protocol = new URL(url).protocol; } catch { return Promise.reject(new Error('invalid url')); }
  if (protocol !== 'http:' && protocol !== 'https:') return Promise.reject(new Error('unsupported scheme'));
  let p = cache.get(url);
  if (p) {
    cache.delete(url); // most recently used goes last
    cache.set(url, p);
    return p;
  }
  p = load(url);
  cache.set(url, p);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  const mine = p;
  mine.catch(() => { if (cache.get(url) === mine) cache.delete(url); });
  return p;
}
