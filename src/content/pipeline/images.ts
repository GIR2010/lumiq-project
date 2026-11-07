import { classifyIcon, type IconVerdict } from '../../core/image/classify';
import { gifFrameCount } from '../../core/image/gif';
import { invertLightness } from '../../core/image/invert';

export interface DecodedImage { width: number; height: number; pixels: Uint8ClampedArray }

export interface ImageDeps {
  fetchImage(url: string): Promise<{ dataUrl: string; animated: boolean }>;
  /** Pixels downscaled to ≤ 64×64 (aspect kept); `full()` lazily renders at the natural size given. */
  decode(dataUrl: string): Promise<DecodedImage & { naturalWidth: number; naturalHeight: number; full: () => DecodedImage }>;
  /** → data:image/png */
  encode(width: number, height: number, pixels: Uint8ClampedArray): string;
}

export interface IconResult { verdict: IconVerdict; inverted?: string; animated: boolean }

const other = (): IconResult => ({ verdict: 'other', animated: false });

/** Larger images get a verdict but no inverted copy: rendering and converting them is too costly. */
const MAX_INVERT_PIXELS = 2_000_000;

/** Bytes of a data: URL (base64 or percent-encoded); empty when malformed. */
function dataUrlBytes(url: string): Uint8Array {
  const comma = url.indexOf(',');
  if (comma < 0) return new Uint8Array(0);
  const body = url.slice(comma + 1);
  try {
    // Percent-decoding byte by byte: decodeURIComponent would read the bytes as UTF-8.
    const bin = /;base64$/i.test(url.slice(0, comma))
      ? atob(body)
      : body.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0) & 0xff);
  } catch {
    return new Uint8Array(0);
  }
}

/** An inline GIF with more than one frame (counted locally, as the service worker does for fetched ones). */
const animatedDataGif = (url: string) => /^data:image\/gif[;,]/i.test(url) && gifFrameCount(dataUrlBytes(url)) > 1;

/** Analyses page images (fetch → decode → classify → invert) with cache, in-flight dedup and limits. */
export class ImageAnalyzer {
  private readonly results = new Map<string, IconResult>();
  private readonly inflight = new Map<string, Promise<IconResult>>();
  private readonly listeners = new Set<(url: string, r: IconResult) => void>();
  private readonly queue: (() => void)[] = [];
  private readonly maxConcurrent: number;
  private readonly maxImages: number;
  private active = 0;
  private accepted = 0;
  private disposed = false;

  constructor(private readonly deps: ImageDeps, opts: { maxConcurrent?: number; maxImages?: number } = {}) {
    this.maxConcurrent = Math.max(1, opts.maxConcurrent ?? 4);
    this.maxImages = opts.maxImages ?? 200;
  }

  get(url: string): IconResult | undefined {
    return this.results.get(url);
  }

  request(url: string): Promise<IconResult> {
    if (this.disposed) return Promise.resolve(other());
    const done = this.results.get(url);
    if (done) return Promise.resolve(done);
    const running = this.inflight.get(url);
    if (running) return running;
    if (this.accepted >= this.maxImages) return Promise.resolve(other());
    this.accepted++;
    const p = this.schedule(() => this.analyze(url)).then((r) => {
      this.inflight.delete(url);
      if (this.disposed) return other();
      this.results.set(url, r);
      for (const cb of [...this.listeners]) {
        try { cb(url, r); } catch { console.debug('[DarkExt] icon result listener failed', url); }
      }
      return r;
    });
    this.inflight.set(url, p);
    return p;
  }

  onResult(cb: (url: string, r: IconResult) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    // Queued jobs see `disposed` and settle at once to 'other' without fetching.
    for (const run of this.queue.splice(0)) run();
  }

  private schedule(job: () => Promise<IconResult>): Promise<IconResult> {
    return new Promise((resolve) => {
      const run = () => {
        this.active++;
        job().then(resolve, () => resolve(other())).finally(() => {
          this.active--;
          this.queue.shift()?.();
        });
      };
      if (this.active < this.maxConcurrent) run();
      else this.queue.push(run);
    });
  }

  private async analyze(url: string): Promise<IconResult> {
    if (this.disposed) return other();
    try {
      const { dataUrl, animated } = url.startsWith('data:')
        ? { dataUrl: url, animated: animatedDataGif(url) }
        : await this.deps.fetchImage(url);
      const img = await this.deps.decode(dataUrl);
      const verdict = classifyIcon(img.pixels, img.width, img.height);
      if (verdict !== 'dark-icon' || animated) return { verdict, animated };
      if (img.naturalWidth * img.naturalHeight > MAX_INVERT_PIXELS) return { verdict, animated };
      const full = img.full();
      return { verdict, animated, inverted: this.deps.encode(full.width, full.height, invertLightness(full.pixels)) };
    } catch {
      console.debug('[DarkExt] icon analysis failed', url);
      return other();
    }
  }
}

const SAMPLE = 64;

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawImage(img: HTMLImageElement, w: number, h: number): DecodedImage {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as Canvas2D | null;
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0, w, h);
  return { width: w, height: h, pixels: ctx.getImageData(0, 0, w, h).data };
}

/** Real browser deps; `sendFetchImage` is the FETCH_IMAGE message round-trip. Covered by e2e. */
export function browserImageDeps(
  sendFetchImage: (url: string) => Promise<{ dataUrl: string; animated: boolean } | { error: string }>,
): ImageDeps {
  return {
    async fetchImage(url) {
      const res = await sendFetchImage(url);
      if ('error' in res) throw new Error(res.error);
      return res;
    },
    async decode(dataUrl) {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      // SVG without intrinsic size reports 0×0.
      const w = img.naturalWidth || SAMPLE;
      const h = img.naturalHeight || SAMPLE;
      const scale = Math.min(1, SAMPLE / Math.max(w, h));
      const small = drawImage(img, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
      return { ...small, naturalWidth: w, naturalHeight: h, full: () => drawImage(img, w, h) };
    },
    encode(width, height, pixels) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
      return canvas.toDataURL('image/png');
    },
  };
}
