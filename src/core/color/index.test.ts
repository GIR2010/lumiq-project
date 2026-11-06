import { parseColor, formatColor, contrastRatio, isNeutral } from './index';

test.each(['#fff', '#ffffff', 'white', 'rgb(255 255 255)', 'rgba(255,255,255,1)', 'hsl(0 0% 100%)'])
  ('%s → белый', s => { const c = parseColor(s)!; expect(c.l).toBeCloseTo(1, 2); expect(c.alpha).toBe(1); });
test('альфа сохраняется', () => expect(parseColor('rgba(0,0,0,.5)')!.alpha).toBeCloseTo(0.5));
test.each(['transparent', 'currentColor', 'inherit', 'var(--x)', 'Canvas', 'CanvasText', 'color-mix(in srgb, red, blue)', 'solid', '10px', ''])
  ('%s → null', s => expect(parseColor(s)).toBeNull());
test('туда-обратно', () => {
  for (const hex of ['#1e1f22', '#6ea8fe', '#f2706b', '#000000', '#ffffff']) expect(formatColor(parseColor(hex)!)).toBe(hex);
});
test('формат с альфой', () => expect(formatColor({ ...parseColor('#000')!, alpha: 0.25 })).toBe('rgba(0, 0, 0, 0.250)'));
test('контраст', () => {
  expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 0);
  expect(contrastRatio('#777', '#fff')).toBeCloseTo(4.48, 1);
});
test('нейтральность', () => { expect(isNeutral(parseColor('#808080')!)).toBe(true); expect(isNeutral(parseColor('#3366ff')!)).toBe(false); });
