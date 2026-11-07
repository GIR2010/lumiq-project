// @vitest-environment jsdom
import { expect, test } from 'vitest';
import type { ColorFn, Role } from '../../core/mapping/types';
import { InlineStyler } from './inline';

const fn: ColorFn = (c, role) => (role === 'bg' ? '#111111' : role === 'text' ? '#eeeeee' : '#333333');
test('apply перекрашивает, restoreAll возвращает исходный атрибут побайтно', () => {
  document.body.innerHTML = '<div id="d" style="color: #000; width: 10px"></div><p id="p"></p>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn); expect(d.style.color).toBe('rgb(238, 238, 238)');
  s.apply(document.getElementById('p')!, fn); // без style — без изменений
  s.restoreAll(); expect(d.getAttribute('style')).toBe('color: #000; width: 10px');
  expect(document.getElementById('p')!.hasAttribute('style')).toBe(false);
});

test('страница переписала style: новый оригинал сохраняется', () => {
  document.body.innerHTML = '<div id="d" style="color: #000"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn);
  d.setAttribute('style', 'width:5px');
  s.apply(d, fn); s.restoreAll();
  expect(d.getAttribute('style')).toBe('width:5px');
});
test('isOwnMutation: apply и restoreAll — свои, изменение страницы — чужое', () => {
  document.body.innerHTML = '<div id="d" style="color: #000"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  const mo = new MutationObserver(() => {}); mo.observe(d, { attributes: true });
  s.apply(d, fn);
  let recs = mo.takeRecords(); expect(recs.length).toBeGreaterThan(0);
  expect(recs.every((r) => s.isOwnMutation(r))).toBe(true);
  s.restoreAll();
  recs = mo.takeRecords(); expect(recs.length).toBeGreaterThan(0);
  expect(recs.every((r) => s.isOwnMutation(r))).toBe(true);
  d.setAttribute('style', 'color: red');
  recs = mo.takeRecords(); expect(recs.some((r) => s.isOwnMutation(r))).toBe(false);
  mo.disconnect();
});

// The page edits an element we styled: our colours must not become its "originals".
for (const reapply of [false, true]) {
  const how = reapply ? 'с apply после правки' : 'без apply после правки';
  test(`страница меняет не-цветовое свойство → restoreAll возвращает исходный цвет и сохраняет правку (${how})`, () => {
    document.body.innerHTML = '<div id="d" style="color:#000"></div>';
    const s = new InlineStyler(); const d = document.getElementById('d')!;
    s.apply(d, fn); expect(d.style.color).toBe('rgb(238, 238, 238)');
    d.style.width = '10px';
    if (reapply) { s.apply(d, fn); expect(d.style.color).toBe('rgb(238, 238, 238)'); }
    s.restoreAll();
    expect(d.style.color).toBe('rgb(0, 0, 0)');
    expect(d.style.width).toBe('10px');
  });
  test(`страница сама меняет цвет → restoreAll оставляет цвет страницы (${how})`, () => {
    document.body.innerHTML = '<div id="d" style="color:#000; background-color:#fff"></div>';
    const s = new InlineStyler(); const d = document.getElementById('d')!;
    s.apply(d, fn);
    d.style.color = 'red';
    if (reapply) { s.apply(d, fn); expect(d.style.color).toBe('rgb(238, 238, 238)'); }
    s.restoreAll();
    expect(d.style.color).toBe('red');
    expect(d.style.backgroundColor).toBe('rgb(255, 255, 255)');
  });
}

const vars = { roleOf: (): Role => 'text', isMixed: (n: string) => n === '--icon' };

test('inline-сокращение background с var() перекрашивается и восстанавливается', () => {
  document.body.innerHTML = '<div id="d" style="background: var(--x,#fff)"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn);
  expect(d.getAttribute('style')).toContain('#111111');
  s.restoreAll();
  expect(d.getAttribute('style')).toBe('background: var(--x,#fff)');
});

test('custom property с var() смешанной переменной переписывается по роли', () => {
  document.body.innerHTML = '<div id="d" style="--x-color:var(--icon)"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn, vars);
  expect(d.style.getPropertyValue('--x-color')).toBe('var(--icon__dx-text, var(--icon))');
  s.restoreAll();
  expect(d.getAttribute('style')).toBe('--x-color:var(--icon)');
});

test('custom property: литеральный цвет внутри тоже перекрашивается по роли', () => {
  document.body.innerHTML = '<div id="d" style="--x-color:var(--icon, #000)"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn, vars);
  expect(d.style.getPropertyValue('--x-color')).toBe('var(--icon__dx-text, var(--icon, #eeeeee))');
});

test('custom property без смешанных переменных не трогается', () => {
  document.body.innerHTML = '<div id="d" style="--a:var(--other); --b:#fff; width:1px"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  const before = d.getAttribute('style');
  const mo = new MutationObserver(() => {}); mo.observe(d, { attributes: true });
  s.apply(d, fn, vars);
  expect(d.getAttribute('style')).toBe(before);
  expect(mo.takeRecords()).toHaveLength(0);
  mo.disconnect();
  s.restoreAll();
  expect(d.getAttribute('style')).toBe(before);
});

test('custom property без vars не трогается', () => {
  document.body.innerHTML = '<div id="d" style="--x-color:var(--icon)"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn);
  expect(d.getAttribute('style')).toBe('--x-color:var(--icon)');
});

test('свойство с var() смешанной переменной переписывается при заданных vars', () => {
  document.body.innerHTML = '<div id="d" style="color: var(--icon)"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn, vars);
  expect(d.style.getPropertyValue('color')).toBe('var(--icon__dx-text, var(--icon))');
  s.restoreAll();
  expect(d.getAttribute('style')).toBe('color: var(--icon)');
});

test('vars с методами, зависящими от this, передаются без отрыва', () => {
  class Table {
    private readonly m = new Set(['--icon']);
    roleOf(): Role { return 'text'; }
    isMixed(n: string): boolean { return this.m.has(n); }
  }
  document.body.innerHTML = '<div id="d" style="--x-color:var(--icon); color:var(--icon)"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn, new Table());
  expect(d.style.getPropertyValue('--x-color')).toBe('var(--icon__dx-text, var(--icon))');
  expect(d.style.getPropertyValue('color')).toBe('var(--icon__dx-text, var(--icon))');
});

test('правка страницы после нашей записи по-прежнему сохраняется (регрессия плана 1)', () => {
  document.body.innerHTML = '<div id="d" style="color:#000; --x-color:var(--icon)"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn, vars);
  expect(d.style.color).toBe('rgb(238, 238, 238)');
  expect(d.style.getPropertyValue('--x-color')).toBe('var(--icon__dx-text, var(--icon))');
  d.style.width = '10px';
  s.apply(d, fn, vars);
  d.style.color = 'red'; // the page sets its own colour
  s.restoreAll();
  expect(d.style.color).toBe('red');
  expect(d.style.width).toBe('10px');
  expect(d.style.getPropertyValue('--x-color')).toBe('var(--icon)');
});
