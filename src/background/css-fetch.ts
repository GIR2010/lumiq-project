const TIMEOUT_MS = 10_000;
const cache = new Map<string, Promise<string>>();

export function resetCssCache(): void { cache.clear(); }

async function load(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: 'omit', signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function fetchCss(url: string): Promise<string> {
  let protocol: string;
  try { protocol = new URL(url).protocol; } catch { return Promise.reject(new Error('invalid url')); }
  if (protocol !== 'http:' && protocol !== 'https:') return Promise.reject(new Error('unsupported scheme'));
  let p = cache.get(url);
  if (!p) {
    p = load(url);
    cache.set(url, p);
    const mine = p;
    mine.catch(() => { if (cache.get(url) === mine) cache.delete(url); });
  }
  return p;
}
