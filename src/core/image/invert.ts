import { converter, clampChroma, rgb as toRgb } from 'culori';

const toOklch = converter('oklch');
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** Flips OKLCH lightness (L' = 1 − L), keeping hue and chroma (clamped into sRGB). Returns a new array; alpha unchanged. */
export function invertLightness(pixels: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels);
  for (let p = 0; p + 3 < pixels.length; p += 4) {
    if (pixels[p + 3] === 0) continue;
    const o = toOklch({ mode: 'rgb', r: pixels[p] / 255, g: pixels[p + 1] / 255, b: pixels[p + 2] / 255 });
    const h = o.h === undefined || Number.isNaN(o.h) ? 0 : o.h;
    const flipped = clampChroma({ mode: 'oklch', l: 1 - (o.l ?? 0), c: o.c ?? 0, h }, 'oklch');
    const { r, g, b } = toRgb(flipped);
    out[p] = byte(r);
    out[p + 1] = byte(g);
    out[p + 2] = byte(b);
  }
  return out;
}
