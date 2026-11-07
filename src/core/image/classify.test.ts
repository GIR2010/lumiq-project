import { classifyIcon } from './classify';

type Px = [number, number, number, number];
function make(w: number, h: number, f: (x: number, y: number) => Px): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(f(x, y), (y * w + x) * 4);
  return out;
}
const T: Px = [0, 0, 0, 0];

test('чёрный глиф на прозрачном → dark-icon', () =>
  expect(classifyIcon(make(16, 16, (x, y) => (x > 4 && x < 12 && y > 4 && y < 12 ? [0, 0, 0, 255] : T)), 16, 16)).toBe('dark-icon'));
test('тёмно-синий текст на прозрачном → dark-icon (цвет не важен)', () =>
  expect(classifyIcon(make(20, 20, (x, y) => (y >= 8 && y < 11 && x < 20 ? [0, 48, 133, 255] : T)), 20, 20)).toBe('dark-icon'));
test('белый глиф → other', () =>
  expect(classifyIcon(make(16, 16, (x, y) => (x > 4 && x < 12 && y > 4 && y < 12 ? [255, 255, 255, 255] : T)), 16, 16)).toBe('other'));
test('цветной светлый логотип → other', () =>
  expect(classifyIcon(make(16, 16, (x, y) => (x > 4 && x < 12 && y > 4 && y < 12 ? [255, 160, 40, 255] : T)), 16, 16)).toBe('other'));
test('непрозрачное фото (alpha 255 везде) → other', () =>
  expect(classifyIcon(make(16, 16, () => [0, 0, 0, 255]), 16, 16)).toBe('other'));
test('пустая картинка (все alpha 0) → other', () =>
  expect(classifyIcon(make(16, 16, () => T), 16, 16)).toBe('other'));
test('почти прозрачная (непрозрачных < 1 %) → other', () =>
  expect(classifyIcon(make(100, 100, (x, y) => (x === 0 && y < 50 ? [0, 0, 0, 255] : T)), 100, 100)).toBe('other'));
test('alpha ≤ 40 считается прозрачным', () =>
  expect(classifyIcon(make(10, 10, (x) => (x < 5 ? [0, 0, 0, 255] : [0, 0, 0, 40])), 10, 10)).toBe('dark-icon'));
test.each([[39, 'other'], [40, 'dark-icon'], [41, 'dark-icon']] as const)('граница прозрачности %s %%', (pct, v) =>
  expect(classifyIcon(make(100, 1, x => (x < pct ? T : [0, 0, 0, 255])), 100, 1)).toBe(v));
test('среднее по непрозрачным: половина чёрных и половина белых (L≈0.5) → other', () =>
  expect(classifyIcon(make(20, 20, (x, y) => (y < 10 ? T : x < 10 ? [0, 0, 0, 255] : [255, 255, 255, 255])), 20, 20)).toBe('other'));
test('средняя светлота чуть выше 0.35 при прозрачности 50 % → other', () =>
  expect(classifyIcon(make(20, 20, (x, y) => (y < 10 ? T : [60, 60, 60, 255])), 20, 20)).toBe('other'));
test('средняя светлота ниже 0.35 при прозрачности 50 % → dark-icon', () =>
  expect(classifyIcon(make(20, 20, (x, y) => (y < 10 ? T : [50, 50, 50, 255])), 20, 20)).toBe('dark-icon'));
