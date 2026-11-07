// @vitest-environment jsdom
import { expect, test } from 'vitest';
import type { ColorFn } from '../../core/mapping/types';
import { VarRoleCounter, type VarRoles } from '../../core/css/vars';
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

type StubMap = Record<string, { roles: Array<'bg' | 'text' | 'border' | 'shadow'> }>;
function stub(map: StubMap): VarRoles {
  return {
    roleOf: (n: string) => map[n]?.roles[0] ?? 'bg',
    rolesOf: (n: string) => map[n]?.roles ?? [],
    isMixed: (n: string) => (map[n]?.roles.length ?? 0) > 1,
  } as unknown as VarRoles;
}
test('смешанная переменная: основное значение + двойники по ролям', () => {
  const css = buildMirrorCss(parseCssText(':root{--white:#fff}'), fn, stub({ '--white': { roles: ['bg', 'text'] } }));
  expect(css).toBe(':root{--white:#111111;--white__dx-bg:#111111;--white__dx-text:#eeeeee;}');
});
test('использование смешанной переменной переписывается даже без литеральных цветов', () => {
  const css = buildMirrorCss(parseCssText('.i{color:var(--white)}'), fn, stub({ '--white': { roles: ['bg', 'text'] } }));
  expect(css).toBe('.i{color:var(--white__dx-text, var(--white));}');
});
test('несколько определений одной переменной (светлая/тёмная тема) — двойники у каждого', () => {
  const css = buildMirrorCss(parseCssText(':root{--c:#fff}.dark{--c:#000}'), fn, stub({ '--c': { roles: ['bg', 'text'] } }));
  expect(css).toContain(':root{--c:'); expect(css).toContain('.dark{--c:'); expect((css.match(/--c__dx-text/g) ?? []).length).toBe(2);
});
test('числовая переменная не получает двойников и не ломается', () => {
  const css = buildMirrorCss(parseCssText(':root{--su1:clamp(1px,calc(1px*1),calc(1px*1))}'), fn, stub({ '--su1': { roles: ['bg', 'text'] } }));
  expect(css).toBe('');
});
test('цепочка: --b:var(--a) для смешанной --a → переписывается по роли --b', () => {
  const css = buildMirrorCss(parseCssText(':root{--b:var(--a)}'), fn, stub({ '--a': { roles: ['bg', 'text'] }, '--b': { roles: ['text'] } }));
  expect(css).toBe(':root{--b:var(--a__dx-text, var(--a));}');
});
test('isMask: background-color правила считается цветом значка (роль text)', () => {
  const css = buildMirrorCss(parseCssText('.ic{background-color:#404244}'), fn, stub({}), (s) => s === '.ic');
  expect(css).toBe('.ic{background-color:#eeeeee;}');
});
test('isMask: var() смешанной переменной в background-color переписывается по роли text', () => {
  const css = buildMirrorCss(parseCssText('.ic{background-color:var(--w)}'), fn, stub({ '--w': { roles: ['bg', 'text'] } }), (s) => s === '.ic');
  expect(css).toBe('.ic{background-color:var(--w__dx-text, var(--w));}');
});
test('двойники сохраняют !important', () => {
  const css = buildMirrorCss(parseCssText(':root{--w:#fff!important}'), fn, stub({ '--w': { roles: ['bg', 'text'] } }));
  expect(css).toBe(':root{--w:#111111 !important;--w__dx-bg:#111111 !important;--w__dx-text:#eeeeee !important;}');
});
for (const kw of ['transparent', 'currentColor']) {
  test(`R17: ключевое значение (${kw}) смешанной переменной получает двойники`, () => {
    const css = buildMirrorCss(parseCssText(`:root{--c:#fff}.g{--c:${kw}}`), fn, stub({ '--c': { roles: ['bg', 'text'] } }));
    const g = css.slice(css.indexOf('.g{'));
    const v = kw.toLowerCase() === 'currentcolor' ? g.match(/--c__dx-bg:([^;]*);/)![1] : kw;
    expect(v.toLowerCase()).toBe(kw.toLowerCase());
    expect(g).toMatch(new RegExp(`^\.g\{(--c:[^;]*;)?--c__dx-bg:${v};--c__dx-text:${v};\}$`, 'i'));
  });
}
test('R17: CSS-wide ключевые слова (inherit/initial/unset/revert/revert-layer) тоже дают двойники', () => {
  for (const kw of ['inherit', 'initial', 'unset', 'revert', 'revert-layer']) {
    const css = buildMirrorCss(parseCssText(`.g{--c:${kw}}`), fn, stub({ '--c': { roles: ['bg', 'text'] } }));
    expect(css, kw).toContain('--c__dx-bg:');
    expect(css, kw).toContain('--c__dx-text:');
  }
});
test('R19: isMask вызывается только для правил с фоном', () => {
  const seen: string[] = [];
  const isMask = (s: string): boolean => { seen.push(s); return false; };
  buildMirrorCss(parseCssText('.a{color:#000}.b{background-color:#fff}.c{background:#fff}.d{--x:#fff}'), fn, stub({}), isMask);
  expect(seen).toEqual(['.b', '.c']);
});
