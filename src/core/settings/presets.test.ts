import { expect, test } from 'vitest';
import { contrastRatio } from '../color';
import { PRESETS, findStyle } from './presets';

test.each(PRESETS)('$id: контраст text/bg, textMuted/bg, onAccent/accent, link/bg ≥ 4.5', ({ colors: c }) => {
  for (const [fg, bg] of [[c.text, c.bg], [c.textMuted, c.bg], [c.onAccent, c.accent], [c.link, c.bg]] as const)
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
});
test('contrast: text/bg ≥ 7', () => { const c = PRESETS.find(p => p.id === 'contrast')!.colors; expect(contrastRatio(c.text, c.bg)).toBeGreaterThanOrEqual(7); });
test('oled.bg = #000000', () => expect(PRESETS.find(p => p.id === 'oled')!.colors.bg).toBe('#000000'));
test('findStyle: неизвестный → graphite; пользовательский находится', () => {
  expect(findStyle('nope', []).id).toBe('graphite');
  const u = { id: 'u1', name: 'Мой', c: PRESETS[1].colors };
  expect(findStyle('u1', [u]).colors).toBe(u.c);
});
