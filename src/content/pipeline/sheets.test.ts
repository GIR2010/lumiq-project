// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
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
