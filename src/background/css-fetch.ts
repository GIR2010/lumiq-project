import { createLruLoader, readCapped, schemeError } from './fetch-util';

const TIMEOUT_MS = 10_000;
/** Largest stylesheet we fetch for a page. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Cached sheets (LRU; failed requests are not cached). */
const CACHE_SIZE = 100;

function isCss(res: Response): boolean {
  const type = res.headers.get('content-type') ?? '';
  return type.split(';')[0].trim().toLowerCase() === 'text/css';
}

/** Reads the body as UTF-8 (like Response.text()), giving up as soon as it exceeds MAX_BYTES. */
async function readText(res: Response): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  await readCapped(res, MAX_BYTES, 'stylesheet too large', (v) => { text += decoder.decode(v, { stream: true }); });
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
    return await readText(res);
  } finally {
    clearTimeout(timer);
  }
}

const loader = createLruLoader(CACHE_SIZE, load);

export function resetCssCache(): void { loader.reset(); }

export function fetchCss(url: string): Promise<string> {
  const bad = schemeError(url);
  return bad ? Promise.reject(bad) : loader.get(url);
}
