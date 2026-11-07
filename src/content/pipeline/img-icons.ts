import type { ImageAnalyzer } from './images';

const ATTR = 'data-darkext-icon';
/** Both displayed sides must be at most this many CSS pixels. */
const MAX_SIDE = 400;
/** Smaller than this on either side (displayed or natural): a tracking pixel or spacer, not an icon. */
const MIN_SIDE = 8;
/** The service worker fetches http(s) only; data: URLs are decoded on the page. blob: etc. are skipped. */
const ANALYZABLE = /^(?:https?|data):/i;

type Root = Document | ShadowRoot;

const sourceOf = (img: HTMLImageElement) => img.currentSrc || img.src;
/** The source attributes as set by the page: `currentSrc` may still be the old one right after a change. */
const attrsOf = (img: HTMLImageElement) => `${img.getAttribute('src') ?? ''} ${img.getAttribute('srcset') ?? ''}`;

/**
 * Marks dark icon <img> elements (logos, glyphs) with `data-darkext-icon`; the base sheet inverts them
 * with a CSS filter. The image source itself is never changed.
 */
export class ImgIcons {
  /** Images waiting for `load`, with the function that removes the listeners. */
  private readonly waiting = new Map<HTMLImageElement, () => void>();
  /** Roots that may hold our attribute (cleared on `clear`). */
  private readonly roots = new Set<Root>();
  /** The source (URL and attributes) each marked image was marked for. */
  private readonly markedFor = new WeakMap<HTMLImageElement, string>();
  private stopped = false;

  constructor(private readonly analyzer: Pick<ImageAnalyzer, 'request'>) {}

  /** Analyses the image (after it loads) and marks it when the verdict is a dark icon. */
  consider(img: HTMLImageElement): void {
    if (this.stopped) return;
    this.waiting.get(img)?.();
    const url = sourceOf(img);
    const attrs = attrsOf(img);
    const key = `${url} ${attrs}`;
    // A new source (or one still loading) drops the old mark until its own verdict arrives.
    if (img.hasAttribute(ATTR) && (!img.complete || this.markedFor.get(img) !== key)) this.unmark(img);
    if (!img.complete) {
      this.waitLoad(img);
      return;
    }
    if (!url || !ANALYZABLE.test(url)) return;
    let { width, height } = img.getBoundingClientRect();
    // Not rendered (e.g. in a closed menu): its natural size decides, so it is ready once shown.
    if (width === 0 && height === 0) ({ naturalWidth: width, naturalHeight: height } = img);
    if (width === 0 && height === 0) return; // no size at all (broken image)
    // Beacons: tiny on screen, or a tiny file stretched (a natural 0 is an SVG without intrinsic size).
    const tinyNatural = (img.naturalWidth > 0 && img.naturalWidth < MIN_SIDE) || (img.naturalHeight > 0 && img.naturalHeight < MIN_SIDE);
    if (width < MIN_SIDE || height < MIN_SIDE || tinyNatural) {
      this.unmark(img);
      return;
    }
    if (width > MAX_SIDE || height > MAX_SIDE) {
      this.unmark(img);
      return;
    }
    const failed = () => console.debug('[DarkExt] icon analysis failed', url);
    let result: Promise<{ verdict: string }>;
    try {
      result = Promise.resolve(this.analyzer.request(url));
    } catch {
      failed();
      return;
    }
    result.then((r) => {
      if (this.stopped || sourceOf(img) !== url || attrsOf(img) !== attrs) return; // cleared, or the source changed meanwhile
      if (r.verdict === 'dark-icon') {
        img.setAttribute(ATTR, '1');
        this.markedFor.set(img, key);
        const root = img.getRootNode(); // where clear() will look for the mark
        if (root instanceof Document || root instanceof ShadowRoot) this.roots.add(root);
      } else {
        this.unmark(img);
      }
    }).catch(failed);
  }

  /** Considers every <img> of the root. */
  scan(root: ParentNode): void {
    if (this.stopped) return;
    if (root instanceof Document || root instanceof ShadowRoot) this.roots.add(root);
    this.prune();
    for (const img of Array.from(root.querySelectorAll('img'))) this.consider(img);
  }

  /** Forgets images removed from the page before they loaded (their listeners go); a re-added one is considered again. */
  prune(): void {
    for (const [img, stop] of [...this.waiting]) if (!img.isConnected) stop();
  }

  /** Stops listening; late verdicts are dropped. The marks stay (frozen page). */
  stop(): void {
    this.stopped = true;
    for (const stop of [...this.waiting.values()]) stop();
    this.waiting.clear();
  }

  /** Stops and removes every mark of ours. */
  clear(): void {
    this.stop();
    for (const root of this.roots) {
      for (const img of Array.from(root.querySelectorAll(`img[${ATTR}]`))) img.removeAttribute(ATTR);
    }
    this.roots.clear();
  }

  private unmark(img: HTMLImageElement): void {
    img.removeAttribute(ATTR);
    this.markedFor.delete(img);
  }

  private waitLoad(img: HTMLImageElement): void {
    const stop = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', stop);
      this.waiting.delete(img);
    };
    const onLoad = () => {
      stop();
      this.consider(img);
    };
    img.addEventListener('load', onLoad);
    img.addEventListener('error', stop);
    this.waiting.set(img, stop);
  }
}
