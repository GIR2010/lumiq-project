// @vitest-environment jsdom
import { expect, test } from 'vitest';
import type { ColorFn } from '../../core/mapping/types';
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
