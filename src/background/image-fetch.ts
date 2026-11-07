import { gifFrameCount } from '../core/image/gif';
import { createLruLoader, readCapped, schemeError } from './fetch-util';

const TIMEOUT_MS = 10_000;
/** Largest image we fetch for a page: 1 MB. */
const MAX_BYTES = 1024 * 1024;
/** Cached images (LRU; failed requests are not cached). */
const CACHE_SIZE = 100;
/** Bytes per String.fromCharCode call, far below the argument-count limit. */
const B64_CHUNK = 0x8000;

export interface FetchedImage { dataUrl: string; animated: boolean }

function mimeOf(res: Response): string {
  return (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  return btoa(bin);
}

async function load(url: string): Promise<FetchedImage> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: 'omit', signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mime = mimeOf(res);
    if (!mime.startsWith('image/')) throw new Error(`not an image: ${res.headers.get('content-type') ?? 'no content-type'}`);
    if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('image too large');
    const chunks: Uint8Array[] = [];
    await readCapped(res, MAX_BYTES, 'image too large', (c) => { chunks.push(c); });
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
    return {
      dataUrl: `data:${mime};base64,${toBase64(bytes)}`,
      animated: mime === 'image/gif' && gifFrameCount(bytes) > 1,
    };
  } finally {
    clearTimeout(timer);
  }
}

const loader = createLruLoader(CACHE_SIZE, load);

export function resetImageCache(): void { loader.reset(); }

export function fetchImage(url: string): Promise<FetchedImage> {
  const bad = schemeError(url);
  return bad ? Promise.reject(bad) : loader.get(url);
}
