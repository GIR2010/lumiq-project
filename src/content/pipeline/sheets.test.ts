// @vitest-environment jsdom
import { describe, it, expect, test } from 'vitest';
import { VarRoleCounter, type VarLinks } from '../../core/css/vars';
import { parseCssText, countVarUsage, countStyleDeclaration } from './sheets';

describe('countVarUsage links', () => {
  it('collects links, defs and usages from rules', () => {
    const rules = parseCssText(':root{--b:var(--a)}.t{color:var(--b)}');
    const c = new VarRoleCounter();
    const defs = new Set<string>();
    const links: VarLinks = [];
    countVarUsage(rules, c, defs, links);
    expect(links).toEqual([['--b', '--a']]);
    expect(defs.has('--b')).toBe(true);
    expect(c.countsOf('--b')?.get('text')).toBe(1);
  });

  it('recurses into grouping rules', () => {
    const rules = parseCssText('@media (min-width:1px){:root{--b:var(--a)}.t{color:var(--b)}}');
    const c = new VarRoleCounter();
    const links: VarLinks = [];
    countVarUsage(rules, c, undefined, links);
    expect(links).toEqual([['--b', '--a']]);
    expect(c.countsOf('--b')?.get('text')).toBe(1);
  });
});

describe('countStyleDeclaration', () => {
  it('handles inline style declarations', () => {
    const el = document.createElement('div');
    el.setAttribute('style', '--x-color:var(--icon);color:var(--x-color)');
    const c = new VarRoleCounter();
    const defs = new Set<string>();
    const links: VarLinks = [];
    countStyleDeclaration(el.style, c, links, defs);
    expect(links).toEqual([['--x-color', '--icon']]);
    expect(defs.has('--x-color')).toBe(true);
    expect(c.countsOf('--x-color')?.get('text')).toBe(1);
  });
});

describe('mask elements', () => {
  const css = '.ic{background-color:var(--c)}';
  it('counts background-color as text for mask selectors', () => {
    const c = new VarRoleCounter();
    countVarUsage(parseCssText(css), c, undefined, undefined, (s) => s === '.ic');
    expect(c.countsOf('--c')?.get('text')).toBe(1);
    expect(c.countsOf('--c')?.get('bg')).toBeUndefined();
  });
  it('counts as bg without isMask', () => {
    const c = new VarRoleCounter();
    countVarUsage(parseCssText(css), c);
    expect(c.countsOf('--c')?.get('bg')).toBe(1);
    expect(c.countsOf('--c')?.get('text')).toBeUndefined();
  });
  it('leaves other properties unchanged and handles background shorthand', () => {
    const c = new VarRoleCounter();
    countVarUsage(parseCssText('.ic{background:var(--s);border-color:var(--b)}'), c, undefined, undefined, () => true);
    expect(c.countsOf('--s')?.get('text')).toBe(1);
    expect(c.countsOf('--b')?.get('bg')).toBeUndefined();
    expect(c.countsOf('--b')?.get('border')).toBe(1);
  });
});
test('R19: countVarUsage вызывает isMask только для правил с фоном', () => {
  const seen: string[] = [];
  const isMask = (s: string): boolean => { seen.push(s); return false; };
  countVarUsage(parseCssText('.a{color:var(--x)}.b{background-color:var(--x)}.c{width:1px}'), new VarRoleCounter(), undefined, undefined, isMask);
  expect(seen).toEqual(['.b']);
});

import { collectImageUrls } from './sheets';
test('collectImageUrls: @media, относительные, без градиентов/слоёв, без дублей', () => {
  const rules = parseCssText('.a{background-image:url(a.png)}@media (min-width:1px){.b{list-style:url(/b.gif) inside}}.c{background:linear-gradient(red,blue)}.d{background-image:url(x.png),url(y.png)}.e{background:url(a.png)}.f{content:url(c.svg)}');
  expect(collectImageUrls(rules, 'https://s.com/css/m.css').sort()).toEqual(['https://s.com/b.gif', 'https://s.com/css/a.png', 'https://s.com/css/c.svg']);
});
