import { srgbToOklch } from '../color';

export type IconVerdict = 'dark-icon' | 'other';

const OPAQUE_ALPHA = 40;
const MIN_TRANSPARENT_SHARE = 0.4;
const MAX_MEAN_LIGHTNESS = 0.35;
const MIN_OPAQUE_SHARE = 0.01;

/** Dark glyph on a transparent background (hue is irrelevant). Input: RGBA, expected ≤ 64×64. */
export function classifyIcon(pixels: Uint8ClampedArray, w: number, h: number): IconVerdict {
  const total = w * h;
  if (total <= 0) return 'other';
  let opaque = 0;
  let lightnessSum = 0;
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    if (pixels[p + 3] <= OPAQUE_ALPHA) continue;
    opaque++;
    lightnessSum += srgbToOklch(pixels[p], pixels[p + 1], pixels[p + 2]).l;
  }
  if (opaque === 0) return 'other';
  // Compare in integers to avoid float error at exact boundaries.
  if ((total - opaque) < MIN_TRANSPARENT_SHARE * total - 1e-9) return 'other';
  if (opaque < MIN_OPAQUE_SHARE * total - 1e-9) return 'other';
  return lightnessSum / opaque <= MAX_MEAN_LIGHTNESS ? 'dark-icon' : 'other';
}
