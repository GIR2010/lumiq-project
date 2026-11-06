import { parse, converter, formatHex, clampChroma, wcagContrast, rgb as toRgb } from 'culori';

export type Oklch = { l: number; c: number; h: number; alpha: number };

const toOklch = converter('oklch');

// CSS Color 4 system colors + deprecated system colors (lowercase).
const SYSTEM_COLORS = new Set([
  'accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface', 'buttontext',
  'canvas', 'canvastext', 'field', 'fieldtext', 'graytext', 'highlight', 'highlighttext',
  'linktext', 'mark', 'marktext', 'selecteditem', 'selecteditemtext', 'visitedtext',
  'activeborder', 'activecaption', 'appworkspace', 'background', 'buttonhighlight',
  'buttonshadow', 'captiontext', 'inactiveborder', 'inactivecaption', 'inactivecaptiontext',
  'infobackground', 'infotext', 'menu', 'menutext', 'scrollbar', 'threeddarkshadow',
  'threedface', 'threedhighlight', 'threedlightshadow', 'threedshadow', 'window',
  'windowframe', 'windowtext',
]);

const NON_COLOR_KEYWORDS = new Set([
  'transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer',
]);

export function parseColor(input: string): Oklch | null {
  const s = input.trim().toLowerCase();
  if (!s || NON_COLOR_KEYWORDS.has(s) || SYSTEM_COLORS.has(s)) return null;
  if (s.includes('var(') || s.includes('color-mix(')) return null;
  const parsed = parse(s);
  if (!parsed) return null;
  const o = toOklch(parsed);
  return {
    l: o.l,
    c: o.c ?? 0,
    h: o.h === undefined || Number.isNaN(o.h) ? 0 : o.h,
    alpha: o.alpha ?? 1,
  };
}

export function formatColor(c: Oklch): string {
  const clamped = clampChroma({ mode: 'oklch', l: c.l, c: c.c, h: c.h }, 'oklch');
  const { r, g, b } = toRgb(clamped);
  if (c.alpha === 1) return formatHex({ mode: 'rgb', r, g, b });
  const ch = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${ch(r)}, ${ch(g)}, ${ch(b)}, ${c.alpha.toFixed(3)})`;
}

function toCuloriInput(c: Oklch | string) {
  if (typeof c === 'string') {
    const parsed = parseColor(c);
    if (!parsed) throw new Error(`Unparseable color: ${c}`);
    c = parsed;
  }
  return { mode: 'oklch' as const, l: c.l, c: c.c, h: c.h };
}

export function contrastRatio(a: Oklch | string, b: Oklch | string): number {
  return wcagContrast(toCuloriInput(a), toCuloriInput(b));
}

export function isNeutral(c: Oklch, threshold = 0.02): boolean {
  return c.c < threshold;
}
