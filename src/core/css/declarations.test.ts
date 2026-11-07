import { expect, test } from 'vitest';
import type { ColorFn } from '../mapping/types';
import { isLinkSelector, mapDeclarationValue } from './declarations';

// Shadow colors are dark surfaces, so the stub treats the 'shadow' role like 'bg'.
const fn: ColorFn = (_c, role) => (role === 'bg' || role === 'shadow' ? '#111111' : '#eeeeee');
const ctx = { selector: 'p', isLink: false, isVisited: false };
test.each([
  ['background-color', '#fff', '#111111'],
  ['color', 'rgb(0 0 0)', '#eeeeee'],
  ['box-shadow', '0 1px 2px rgba(0,0,0,.2), inset 0 0 0 1px #ccc', '0 1px 2px #111111, inset 0 0 0 1px #111111'],
  ['background-image', 'linear-gradient(90deg, #fff 0%, rgba(240,240,240,1) 100%)', 'linear-gradient(90deg, #111111 0%, #111111 100%)'],
  // color-mix: colours inside are mapped by the property's role (translate.google.com labels)
  ['color', 'color-mix(in srgb, red, blue)', 'color-mix(in srgb, #eeeeee, #eeeeee)'],
  ['color', 'color-mix(in srgb,var(--gm3-on-surface,#1f1f1f) 62%,transparent)', 'color-mix(in srgb,var(--gm3-on-surface,#eeeeee) 62%,transparent)'],
  // shorthands carrying var(): Chrome keeps them unexpanded (translate.google.com header, fades)
  ['background', 'var(--og-bar-background,var(--gm3-background,#fff))', 'var(--og-bar-background,var(--gm3-background,#111111))'],
  ['background', 'linear-gradient(to right,transparent,var(--gm3-surface,#fff))', 'linear-gradient(to right,transparent,var(--gm3-surface,#111111))'],
  ['border', '1px solid var(--line,#ccc)', '1px solid var(--line,#eeeeee)'],
  ['outline', '2px solid var(--focus,#00f)', '2px solid var(--focus,#eeeeee)'],
])('%s: %s → %s', (p, v, out) => expect(mapDeclarationValue(p, v, fn, ctx)).toBe(out));
test.each([
  ['color', 'transparent'], ['color', 'currentColor'], ['color', 'inherit'], ['color', 'var(--fg)'],
  ['color', 'CanvasText'],
  ['background', 'url(a.png) var(--x,#fff)'], ['background', 'var(--x)'],
  ['background-image', 'url(a.png)'], ['background-image', 'linear-gradient(#fff, #000), url(a.png)'],
  ['background-image', 'none'], ['width', '10px'],
])('%s: %s → null', (p, v) => expect(mapDeclarationValue(p, v, fn, ctx)).toBeNull());
test('var() с fallback-цветом: заменяется только fallback', () =>
  expect(mapDeclarationValue('color', 'var(--x, #000)', fn, ctx)).toBe('var(--x, #eeeeee)'));
test.each([['a', true, false], ['nav a:hover', true, false], ['a:visited', true, true], ['.btn, a.link', true, false], ['abbr', false, false], ['a span', false, false]])
  ('isLinkSelector(%s)', (s, l, v) => expect(isLinkSelector(s)).toEqual({ isLink: l, isVisited: v }));
test.each([
  ['fill', 'url(#blue) red', 'url(#blue) #eeeeee'],
  ['box-shadow', 'calc(tan(45deg)*1px) 0 red', 'calc(tan(45deg)*1px) 0 #111111'],
])('opaque spans / function names: %s: %s', (p, v, out) => expect(mapDeclarationValue(p, v, fn, ctx)).toBe(out));
test.each([['stroke', 'url(#ccc)'], ['fill', 'url(red.svg#a)'], ['color', '"red"'], ['fill', "url('a red.svg')"]])
  ('%s: %s → null', (p, v) => expect(mapDeclarationValue(p, v, fn, ctx)).toBeNull());
test.each([
  ['color', 'rgb(42 42 47/var(--tw-text-opacity))', 'rgb(238 238 238 / var(--tw-text-opacity))'],
  ['background-color', 'rgb(255 255 255/var(--tw-bg-opacity))', 'rgb(17 17 17 / var(--tw-bg-opacity))'],
  ['background-color', 'rgba(255,255,255,var(--a))', 'rgba(17,17,17,var(--a))'],
  ['color', 'hsl(0 0% 10% / var(--a))', 'rgb(238 238 238 / var(--a))'],
])('%s: %s → %s', (p, v, out) => expect(mapDeclarationValue(p, v, fn, ctx)).toBe(out));
test.each([
  ['color', 'rgb(var(--r) 0 0)'], ['color', 'rgb(var(--r) var(--g) var(--b) / var(--a))'], ['color', 'rgb(1 2 3 / var(--a) extra)'],
])('var на месте канала или мусор → null: %s %s', (p, v) => expect(mapDeclarationValue(p, v, fn, ctx)).toBeNull());
test('вложенный фолбэк: var(--x, rgb(0 0 0/var(--a)))', () =>
  expect(mapDeclarationValue('color', 'var(--x, rgb(0 0 0/var(--a)))', fn, ctx)).toBe('var(--x, rgb(238 238 238 / var(--a)))'));
test('box-shadow с несколькими такими цветами', () =>
  expect(mapDeclarationValue('box-shadow', '0 0 0 1px rgb(0 0 0/var(--a)), 0 1px rgb(0 0 0/var(--b))', fn, ctx))
    .toBe('0 0 0 1px rgb(17 17 17 / var(--a)), 0 1px rgb(17 17 17 / var(--b))'));
