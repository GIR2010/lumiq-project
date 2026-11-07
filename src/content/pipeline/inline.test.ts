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

const vars = {
  roleOf: (): Role => 'text',
  rolesOf: (n: string): Role[] => (n === '--icon' ? ['bg', 'text'] : ['text']),
  isMixed: (n: string) => n === '--icon',
};

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
    rolesOf(n: string): Role[] { return this.m.has(n) ? ['bg', 'text'] : ['text']; }
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

// jsdom (like Chrome) cannot hold `background: var(--x)` next to a longhand and read it back, so the
// shorthand's value is faked on the element's style object; the real CSSOM then shows what stays effective.
function withVarShorthand(): { d: HTMLElement; writes: string[] } {
  document.body.innerHTML = '<div id="d" style="background-color:#fff"></div>';
  const d = document.getElementById('d')!;
  const real = d.style.getPropertyValue.bind(d.style);
  d.style.getPropertyValue = (p: string) => (p === 'background' ? 'var(--icon)' : real(p));
  const realSet = d.style.setProperty.bind(d.style);
  const writes: string[] = [];
  d.style.setProperty = (p: string, v: string | null, pr?: string) => { writes.push(p); realSet(p, v, pr); };
  return { d, writes };
}

test('var()-сокращение пишется раньше longhand: перекрашенный background-color остаётся действующим', () => {
  const { d, writes } = withVarShorthand();
  new InlineStyler().apply(d, fn, vars);
  expect(writes).toEqual(['background', 'background-color']);
  expect(d.style.getPropertyValue('background-color')).toBe('rgb(17, 17, 17)');
});

test('restoreAll после правки страницы: сокращение возвращается раньше longhand, longhand действует', () => {
  const { d, writes } = withVarShorthand();
  const s = new InlineStyler();
  s.apply(d, fn, vars);
  writes.length = 0;
  d.style.width = '10px';
  s.restoreAll();
  expect(writes).toEqual(['background', 'background-color']);
  expect(d.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
  expect(d.style.width).toBe('10px');
});

test('повторный apply идемпотентен: двойник не вкладывается', () => {
  document.body.innerHTML = '<div id="d" style="color: var(--icon)"></div>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn, vars); s.apply(d, fn, vars);
  const v = d.style.getPropertyValue('color');
  expect(v).toBe('var(--icon__dx-text, var(--icon))');
  expect(v).not.toContain('var(--icon__dx-text, var(--icon__dx-text');
});

// R18: an inline definition of a mixed variable overrides its twins too, else var(--x__dx-R, var(--x)) picks the :root twin.
const mixed = {
  roleOf: (): Role => 'bg',
  rolesOf: (n: string): Role[] => (n === '--accent' || n === '--icon' ? ['bg', 'text'] : ['bg']),
  isMixed: (n: string) => n === '--accent' || n === '--icon',
};
test('R18: литеральное inline-переопределение смешанной переменной получает двойники', () => {
  document.body.innerHTML = '<span id="d" style="--accent:#e91e63"></span>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn, mixed);
  expect(d.style.getPropertyValue('--accent')).toBe('#e91e63'); // main value of a literal stays
  expect(d.style.getPropertyValue('--accent__dx-bg')).toBe('#111111');
  expect(d.style.getPropertyValue('--accent__dx-text')).toBe('#eeeeee');
  s.restoreAll();
  expect(d.getAttribute('style')).toBe('--accent:#e91e63');
});
test('R18: значение с var() — двойники переписаны по своей роли', () => {
  document.body.innerHTML = '<span id="d" style="--accent:var(--icon)"></span>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn, mixed);
  expect(d.style.getPropertyValue('--accent__dx-bg')).toBe('var(--icon__dx-bg, var(--icon))');
  expect(d.style.getPropertyValue('--accent__dx-text')).toBe('var(--icon__dx-text, var(--icon))');
  s.restoreAll();
  expect(d.getAttribute('style')).toBe('--accent:var(--icon)');
});
test('R18: несмешанное inline custom property не трогается', () => {
  document.body.innerHTML = '<span id="d" style="--plain:#e91e63"></span>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  const mo = new MutationObserver(() => {}); mo.observe(d, { attributes: true });
  s.apply(d, fn, mixed);
  expect(mo.takeRecords()).toHaveLength(0);
  expect(d.getAttribute('style')).toBe('--plain:#e91e63');
  mo.disconnect();
});
test('R18: повторный apply идемпотентен, записи распознаются как свои', () => {
  document.body.innerHTML = '<span id="d" style="--accent:#e91e63"></span>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  const mo = new MutationObserver(() => {}); mo.observe(d, { attributes: true });
  s.apply(d, fn, mixed);
  const once = d.getAttribute('style');
  s.apply(d, fn, mixed);
  expect(d.getAttribute('style')).toBe(once);
  const recs = mo.takeRecords();
  expect(recs.length).toBeGreaterThan(0);
  expect(recs.every((r) => s.isOwnMutation(r))).toBe(true);
  mo.disconnect();
});
test('R18: страница меняет основное свойство — двойники обновляются, restoreAll убирает их', () => {
  const echo: ColorFn = (c, role) => `${role}-${Math.round(c.l)}`;
  document.body.innerHTML = '<span id="d" style="--accent:#ffffff"></span>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, echo, mixed);
  expect(d.style.getPropertyValue('--accent__dx-text')).toBe('text-1');
  d.style.setProperty('--accent', '#000000'); // page JS
  s.apply(d, echo, mixed);
  expect(d.style.getPropertyValue('--accent__dx-text')).toBe('text-0');
  expect(d.style.getPropertyValue('--accent__dx-bg')).toBe('bg-0');
  s.restoreAll();
  expect(d.style.getPropertyValue('--accent')).toBe('#000000');
  expect(d.style.getPropertyValue('--accent__dx-bg')).toBe('');
  expect(d.style.getPropertyValue('--accent__dx-text')).toBe('');
});
test('R18: страница удаляет основное свойство — двойники удаляются при следующем apply', () => {
  document.body.innerHTML = '<span id="d" style="--accent:#e91e63; color:#000"></span>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn, mixed);
  d.style.removeProperty('--accent');
  s.apply(d, fn, mixed);
  expect(d.style.getPropertyValue('--accent__dx-bg')).toBe('');
  expect(d.style.getPropertyValue('--accent__dx-text')).toBe('');
  s.restoreAll();
  expect(d.style.color).toBe('rgb(0, 0, 0)');
  expect(d.style.getPropertyValue('--accent__dx-bg')).toBe('');
});
