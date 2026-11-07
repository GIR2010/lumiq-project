import { expect, test } from 'vitest';
import type { ColorFn } from '../mapping/types';
import { DEFAULT_ADJUSTMENTS } from '../settings/defaults';
import { PRESETS } from '../settings/presets';
import { buildBaseCss, buildFallbackCss } from './base';

const fn: ColorFn = (_c, role) => (role === 'bg' ? '#111111' : '#eeeeee');
test('базовые правила содержат html/body и ::selection; img-фильтр только при img>0', () => {
  const css = buildBaseCss(PRESETS[0].colors, fn, DEFAULT_ADJUSTMENTS);
  expect(css).toMatch(/html,\s*body\s*\{[^}]*background-color:\s*#111111/);
  expect(css).toContain('::selection'); expect(css).not.toContain('brightness(');
  expect(buildBaseCss(PRESETS[0].colors, fn, { ...DEFAULT_ADJUSTMENTS, img: 20 })).toContain('brightness(0.8)');
});

test('запасной стиль: html/body с !important из цветов стиля через fn', () => {
  expect(buildFallbackCss(fn)).toBe('html,body{background-color:#111111 !important;color:#eeeeee !important}');
});
