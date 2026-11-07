// @vitest-environment jsdom
import { expect, test } from 'vitest';
import type { ColorFn } from '../../core/mapping/types';
import { VarRoleCounter } from '../../core/css/vars';
import { buildMirrorCss } from './mirror';
import { parseCssText, countVarUsage, extractImports } from './sheets';

const fn: ColorFn = (c, role) => (role === 'bg' ? '#111111' : role === 'text' ? '#eeeeee' : '#333333');
test('зеркало: селектор, только цветовые свойства, !important, @media', () => {
  const rules = parseCssText(`.a{color:#000;width:10px;background-color:#fff!important}@media (min-width:1px){.b{border-top-color:#ccc}}.c{width:1px}`);
  const css = buildMirrorCss(rules, fn, new VarRoleCounter());
  expect(css).toContain('.a{color:#eeeeee;background-color:#111111 !important;}');
  expect(css).toMatch(/@media \(min-width: ?1px\)\s*\{\s*\.b\{border-top-color:#333333;\}\s*\}/);
  expect(css).not.toContain('width:10px'); expect(css).not.toContain('.c');
});
test('кастомное свойство перекрашивается по роли использования', () => {
  const rules = parseCssText(`:root{--fg:#000}.t{color:var(--fg)}`);
  const vars = new VarRoleCounter(); countVarUsage(rules, vars);
  expect(buildMirrorCss(rules, fn, vars)).toContain(':root{--fg:#eeeeee;}');
});
test('extractImports', () =>
  expect(extractImports(`@import url("x.css"); @import 'y.css' screen;`, 'https://a.com/css/main.css'))
    .toEqual(['https://a.com/css/x.css', 'https://a.com/css/y.css']));
test('сокращение background с var() зеркалируется целиком (Chrome не раскладывает его на longhands)', () => {
  // Emulates Chrome's CSSOM for `background: var(...)`: longhands are pending-substitution (''),
  // the shorthand keeps the original text.
  const decl = { background: 'var(--bar,var(--bg,#fff))', 'background-color': '', 'background-image': '' } as Record<string, string>;
  const longhands = ['background-image', 'background-color'];
  const style = {
    length: longhands.length,
    item: (i: number) => longhands[i],
    getPropertyValue: (p: string) => decl[p] ?? '',
    getPropertyPriority: () => '',
  };
  const rule = { selectorText: '.hdr', style, cssText: '.hdr { background: var(--bar,var(--bg,#fff)); }' };
  Object.setPrototypeOf(rule, CSSStyleRule.prototype);
  const css = buildMirrorCss([rule] as unknown as CSSRuleList, fn, new VarRoleCounter());
  expect(css).toBe('.hdr{background:var(--bar,var(--bg,#111111));}');
});
