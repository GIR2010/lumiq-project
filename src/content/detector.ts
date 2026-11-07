import { parseColor, type Oklch } from '../core/color';

const WHITE: Oklch = { l: 1, c: 0, h: 0, alpha: 1 };

function opaqueBg(win: Window, el: Element | null | undefined): Oklch | null {
  if (!el) return null;
  const c = parseColor(win.getComputedStyle(el).backgroundColor);
  return c && c.alpha > 0.5 ? c : null;
}

/** 3x3 grid of viewport cell centres: the first opaque background under each point, else body, html, white. */
export function sampleBackgrounds(doc: Document, win: Window): Oklch[] {
  const w = win.innerWidth, h = win.innerHeight;
  const fallback = opaqueBg(win, doc.body) ?? opaqueBg(win, doc.documentElement) ?? WHITE;
  const out: Oklch[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const els = typeof doc.elementsFromPoint === 'function'
        ? doc.elementsFromPoint(((col + 0.5) * w) / 3, ((row + 0.5) * h) / 3) : [];
      let found: Oklch | null = null;
      for (const el of els) { found = opaqueBg(win, el); if (found) break; }
      out.push(found ?? fallback);
    }
  }
  return out;
}

export function readSchemeSignals(doc: Document, win: Window): { colorScheme: string; metaScheme: string | null } {
  const root = doc.documentElement;
  const colorScheme = root ? ((win.getComputedStyle(root) as CSSStyleDeclaration & { colorScheme?: string }).colorScheme ?? '') : '';
  const meta = doc.querySelector('meta[name="color-scheme" i]');
  return { colorScheme, metaScheme: meta?.getAttribute('content') ?? null };
}
