import type { Oklch } from '../color';
import type { Adjustments } from '../settings/schema';

const SEPIA = { l: 0.6, c: 0.05, h: 70 };

function mixHue(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180; // shortest signed arc, -180..180
  return (((a + d * t) % 360) + 360) % 360;
}

export function applyAdjustments(c: Oklch, adj: Adjustments, bgL: number): Oklch {
  let { l, c: chroma, h } = c;
  if (adj.br === 100 && adj.ct === 100 && adj.sp === 0 && adj.gs === 0) return { ...c };

  if (adj.br !== 100) l = l * (adj.br / 100);
  if (adj.ct !== 100) l = bgL + (l - bgL) * (adj.ct / 100);
  if (adj.sp !== 0) {
    const t = adj.sp / 100;
    l = l + (SEPIA.l - l) * t;
    h = chroma < 1e-4 ? SEPIA.h : mixHue(h, SEPIA.h, t);
    chroma = chroma + (SEPIA.c - chroma) * t;
  }
  if (adj.gs !== 0) chroma = chroma * (1 - adj.gs / 100);

  return { l: Math.min(1, Math.max(0, l)), c: chroma, h, alpha: c.alpha };
}
