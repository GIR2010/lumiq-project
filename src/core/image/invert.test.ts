import { expect, test, vi } from 'vitest';
import { flipRgb, invertLightness } from './invert';
import { srgbToOklch } from '../color';

test('чёрный → светлый, альфа сохранена', () => {
  const o = invertLightness(Uint8ClampedArray.from([0, 0, 0, 128]));
  expect(o[3]).toBe(128);
  expect(o[0]).toBeGreaterThan(240);
});
test('тёмно-синий → светлый синий (оттенок сохранён)', () => {
  const o = invertLightness(Uint8ClampedArray.from([0, 48, 133, 255]));
  const a = srgbToOklch(0, 48, 133);
  const b = srgbToOklch(o[0], o[1], o[2]);
  expect(Math.abs(b.h - a.h)).toBeLessThan(3);
  expect(Math.abs(b.l - (1 - a.l))).toBeLessThan(0.03);
});
test('вход не мутируется', () => {
  const src = Uint8ClampedArray.from([10, 20, 30, 255, 200, 100, 50, 0]);
  const copy = Uint8ClampedArray.from(src);
  const o = invertLightness(src);
  expect(src).toEqual(copy);
  expect(o).not.toBe(src);
});
test('alpha 0 копируется без изменений', () => {
  const o = invertLightness(Uint8ClampedArray.from([12, 34, 56, 0]));
  expect(Array.from(o)).toEqual([12, 34, 56, 0]);
});
test('I2: преобразование цвета мемоизируется по RGB — 512×512 из двух цветов → 2 преобразования', () => {
  const n = 512 * 512;
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) px.set(i % 2 ? [10, 20, 30, 255] : [200, 100, 50, 128], i * 4);
  const flip = vi.fn(flipRgb);
  const o = invertLightness(px, flip);
  expect(flip).toHaveBeenCalledTimes(2);
  expect(Array.from(o.subarray(0, 8))).toEqual([...flipRgb(200, 100, 50), 128, ...flipRgb(10, 20, 30), 255]);
});
test('I2: альфа не входит в ключ — одинаковый RGB с разной альфой даёт один цвет', () => {
  const flip = vi.fn(flipRgb);
  const o = invertLightness(Uint8ClampedArray.from([0, 0, 0, 255, 0, 0, 0, 64]), flip);
  expect(flip).toHaveBeenCalledTimes(1);
  expect(o[3]).toBe(255); expect(o[7]).toBe(64);
  expect(o[4]).toBe(o[0]);
});
