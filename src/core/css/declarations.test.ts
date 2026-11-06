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
])('%s: %s → %s', (p, v, out) => expect(mapDeclarationValue(p, v, fn, ctx)).toBe(out));
test.each([
  ['color', 'transparent'], ['color', 'currentColor'], ['color', 'inherit'], ['color', 'var(--fg)'],
  ['color', 'CanvasText'], ['color', 'color-mix(in srgb, red, blue)'],
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
