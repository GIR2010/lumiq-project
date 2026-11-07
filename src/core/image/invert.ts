import { converter, clampChroma, rgb as toRgb } from 'culori';

const toOklch = converter('oklch');
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** Inverts one colour (0..255 channels): OKLCH L' = 1 − L, hue and chroma kept (clamped into sRGB). */
export function flipRgb(r: number, g: number, b: number): [number, number, number] {
  const o = toOklch({ mode: 'rgb', r: r / 255, g: g / 255, b: b / 255 });
  const h = o.h === undefined || Number.isNaN(o.h) ? 0 : o.h;
  const flipped = toRgb(clampChroma({ mode: 'oklch', l: 1 - (o.l ?? 0), c: o.c ?? 0, h }, 'oklch'));
  return [byte(flipped.r), byte(flipped.g), byte(flipped.b)];
}

/**
 * Flips OKLCH lightness (L' = 1 − L), keeping hue and chroma (clamped into sRGB). Returns a new array;
 * alpha unchanged. Each distinct RGB is converted once (icons have few colours); `flip` is injectable for tests.
 */
export function invertLightness(pixels: Uint8ClampedArray, flip: typeof flipRgb = flipRgb): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels);
  const memo = new Map<number, [number, number, number]>();
  for (let p = 0; p + 3 < pixels.length; p += 4) {
    if (pixels[p + 3] === 0) continue;
    const key = (pixels[p] << 16) | (pixels[p + 1] << 8) | pixels[p + 2];
    let rgb = memo.get(key);
    if (!rgb) memo.set(key, (rgb = flip(pixels[p], pixels[p + 1], pixels[p + 2])));
    out[p] = rgb[0];
    out[p + 1] = rgb[1];
    out[p + 2] = rgb[2];
  }
  return out;
}
