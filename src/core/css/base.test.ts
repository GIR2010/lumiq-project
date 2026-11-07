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

test('M3: color-scheme, pre/code, таблицы, hr и ::placeholder (§6.4)', () => {
  const colors = PRESETS[0].colors;
  const css = buildBaseCss(colors, fn, DEFAULT_ADJUSTMENTS);
  expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/);
  expect(css).toMatch(/pre,\s*code\s*\{[^}]*background-color:\s*#111111/);
  expect(css).toMatch(/table,\s*th,\s*td\s*\{[^}]*border-color:\s*#eeeeee/);
  expect(css).toMatch(/hr\s*\{[^}]*border-color:\s*#eeeeee/);
  expect(css).toContain(`::placeholder { color: ${colors.textMuted}; }`);
});
