// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { StyleWriter } from './writer';

test('base первым в head, зеркало сразу после источника, clear убирает всё', () => {
  document.head.innerHTML = '<style id="s1">.a{}</style>';
  const w = new StyleWriter(document); const s1 = document.getElementById('s1')!;
  w.setBase('html{}'); w.setMirror(s1, '.a{color:red}');
  expect(document.head.firstElementChild!.getAttribute('data-darkext')).toBe('base');
  expect(s1.nextElementSibling!.getAttribute('data-darkext')).toBe('mirror');
  w.setMirror(s1, '.a{color:blue}'); expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
  w.clear(); expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
});
test('без <head>: base в documentElement', () => {
  const doc = document.implementation.createHTMLDocument(''); doc.head.remove();
  const w = new StyleWriter(doc); w.setBase('html{}');
  expect(doc.documentElement.querySelector('[data-darkext=base]')).not.toBeNull();
});
test('setDisabled переключает media', () => {
  document.head.innerHTML = '';
  const w = new StyleWriter(document); w.setBase('html{}'); w.setDisabled(true);
  expect(document.querySelector('[data-darkext=base]')!.getAttribute('media')).toBe('not all');
});

test('adopted: зеркало сразу после источника', () => {
  const A = new CSSStyleSheet(); const B = new CSSStyleSheet();
  document.adoptedStyleSheets = [A, B];
  const w = new StyleWriter(document);
  w.setMirror(A, '.a{color:red}');
  const list = document.adoptedStyleSheets;
  expect(list.length).toBe(3); expect(list[0]).toBe(A); expect(list[2]).toBe(B);
  w.setMirror(A, '.a{color:blue}'); expect(document.adoptedStyleSheets).toEqual(list);
  w.clear(); document.adoptedStyleSheets = [];
});
test('ensureBaseFirst: head появился позже / страница вставила узел в начало', () => {
  const doc = document.implementation.createHTMLDocument(''); doc.head.remove();
  const w = new StyleWriter(doc); w.setBase('html{}');
  const head = doc.createElement('head'); doc.documentElement.prepend(head);
  w.ensureBaseFirst();
  expect(head.firstElementChild!.getAttribute('data-darkext')).toBe('base');
  head.prepend(doc.createElement('meta'));
  expect(head.firstElementChild!.tagName).toBe('META');
  w.ensureBaseFirst();
  expect(head.firstElementChild!.getAttribute('data-darkext')).toBe('base');
});
test('media источника копируется в зеркало, setDisabled сохраняет его', () => {
  document.head.innerHTML = '<style id="s" media="print">.a{}</style>';
  const w = new StyleWriter(document); const s = document.getElementById('s')!;
  w.setMirror(s, '.a{color:red}');
  const m = s.nextElementSibling!;
  expect(m.getAttribute('media')).toBe('print');
  w.setDisabled(true); expect(m.getAttribute('media')).toBe('not all');
  w.setDisabled(false); expect(m.getAttribute('media')).toBe('print');
  s.setAttribute('media', 'screen'); w.setMirror(s, '.a{color:blue}');
  expect(m.getAttribute('media')).toBe('screen');
  w.clear();
});
