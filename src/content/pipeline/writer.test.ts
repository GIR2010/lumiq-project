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
