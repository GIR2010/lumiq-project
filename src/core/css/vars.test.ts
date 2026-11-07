import { expect, test } from 'vitest';
import { VarRoleCounter, VarRoleTable, collectVarUsage, type VarLinks } from './vars';

test('преобладающая роль и умолчание bg', () => {
  const c = new VarRoleCounter();
  collectVarUsage('color', 'var(--fg)', c); collectVarUsage('border-top-color', 'var(--fg)', c); collectVarUsage('color', 'var(--fg)', c);
  expect(c.roleOf('--fg')).toBe('text'); expect(c.roleOf('--unknown')).toBe('bg');
});

test('VarRoleTable: счётчики по источникам, повторная установка заменяет, изменения ролей сообщаются', () => {
  const a = new VarRoleCounter(); collectVarUsage('color', 'var(--x)', a);
  const b = new VarRoleCounter(); collectVarUsage('background-color', 'var(--x)', b); collectVarUsage('background', 'var(--x)', b);
  const t = new VarRoleTable();
  expect([...t.set('a', a)]).toEqual(['--x']); // bg (default) → text
  expect(t.roleOf('--x')).toBe('text');
  expect([...t.set('b', b)]).toEqual(['--x']); // text 1 vs bg 2 → bg
  expect([...t.set('a', a)]).toEqual([]); // same counts again: no double counting
  expect([...t.set('a', a)]).toEqual([]);
  expect(t.roleOf('--x')).toBe('bg');
  expect([...t.delete('b')]).toEqual(['--x']);
  expect(t.roleOf('--x')).toBe('text');
  t.clear(); expect(t.roleOf('--x')).toBe('bg'); // '--x' carries no name hint
});
test('сокращённые свойства с var() учитываются по своей роли', () => {
  const c = new VarRoleCounter();
  collectVarUsage('background', 'linear-gradient(to right,transparent,var(--surf,#fff))', c);
  collectVarUsage('border', '1px solid var(--line)', c);
  expect(c.roleOf('--surf')).toBe('bg');
  expect(c.roleOf('--line')).toBe('border');
});

const table = () => new VarRoleTable();
const use = (c: VarRoleCounter, prop: string, value: string, n = 1, links?: VarLinks) => {
  for (let i = 0; i < n; i++) collectVarUsage(prop, value, c, links);
};

test('цепочка: --x-color:var(--icon) + color:var(--x-color) ⇒ --icon получает text', () => {
  const t = table(); const c = new VarRoleCounter(); const links: VarLinks = [];
  collectVarUsage('--x-color', 'var(--icon)', c, links); collectVarUsage('color', 'var(--x-color)', c, links);
  expect(links).toEqual([['--x-color', '--icon']]);
  t.set('s', c, links);
  expect(t.roleOf('--x-color')).toBe('text'); expect(t.roleOf('--icon')).toBe('text');
});

test('цепочка из 3 звеньев', () => {
  const t = table(); const c = new VarRoleCounter(); const links: VarLinks = [];
  collectVarUsage('--a', 'var(--b)', c, links); collectVarUsage('--b', 'var(--c)', c, links); collectVarUsage('color', 'var(--a)', c, links);
  t.set('s', c, links);
  expect(t.roleOf('--c')).toBe('text'); expect(t.rolesOf('--c')).toEqual(['text']);
});

test('цепочка длиннее 5 звеньев обрывается', () => {
  const t = table(); const c = new VarRoleCounter(); const links: VarLinks = [];
  for (let i = 0; i < 7; i++) collectVarUsage(`--v${i}`, `var(--v${i + 1})`, c, links);
  collectVarUsage('color', 'var(--v0)', c, links);
  t.set('s', c, links);
  expect(t.rolesOf('--v5')).toEqual(['text']);
  expect(t.rolesOf('--v6')).toEqual([]);
});

test('цикл --a:var(--b);--b:var(--a) не зависает и даёт ответ', () => {
  const t = table(); const c = new VarRoleCounter(); const links: VarLinks = [];
  collectVarUsage('--a', 'var(--b)', c, links); collectVarUsage('--b', 'var(--a)', c, links); collectVarUsage('color', 'var(--a)', c, links);
  t.set('s', c, links); expect(t.roleOf('--b')).toBe('text'); expect(t.roleOf('--a')).toBe('text');
});

test('смешанная: 5×color + 3×background-color', () => {
  const t = table(); const c = new VarRoleCounter();
  use(c, 'color', 'var(--m)', 5); use(c, 'background-color', 'var(--m)', 3);
  t.set('s', c);
  expect(t.isMixed('--m')).toBe(true); expect(t.rolesOf('--m')).toEqual(['text', 'bg']); expect(t.roleOf('--m')).toBe('text');
});

test('не смешанная: 9×color + 1×background-color (10 % < 20 %)', () => {
  const t = table(); const c = new VarRoleCounter();
  use(c, 'color', 'var(--m)', 9); use(c, 'background-color', 'var(--m)', 1);
  t.set('s', c);
  expect(t.isMixed('--m')).toBe(false); expect(t.roleOf('--m')).toBe('text'); expect(t.rolesOf('--m')).toEqual(['text', 'bg']);
});

test('ровно 20 % — смешанная; одна роль и неизвестное имя — нет', () => {
  const t = table(); const c = new VarRoleCounter();
  use(c, 'color', 'var(--m)', 4); use(c, 'border-color', 'var(--m)', 1); use(c, 'color', 'var(--one)', 2);
  t.set('s', c);
  expect(t.isMixed('--m')).toBe(true); expect(t.isMixed('--one')).toBe(false); expect(t.isMixed('--none')).toBe(false);
  expect(t.rolesOf('--none')).toEqual([]);
});

test('смешанность учитывает использования, пришедшие по цепочке', () => {
  const t = table(); const c = new VarRoleCounter(); const links: VarLinks = [];
  collectVarUsage('--b', 'var(--a)', c, links);
  use(c, 'color', 'var(--a)', 3, links); use(c, 'color', 'var(--b)', 1, links); use(c, 'background-color', 'var(--b)', 1, links);
  t.set('s', c, links);
  // --a: direct text 3, plus eff(--b) = text 1 + bg 1
  expect(t.rolesOf('--a')).toEqual(['text', 'bg']); expect(t.isMixed('--a')).toBe(true);
});

test('подсказка по имени, если использований нет; иначе приоритет использований', () => {
  const t = table(); expect(t.roleOf('--secondary-icon')).toBe('text'); expect(t.roleOf('--unknown')).toBe('bg');
  const c = new VarRoleCounter(); use(c, 'background-color', 'var(--secondary-icon)');
  t.set('s', c);
  expect(t.roleOf('--secondary-icon')).toBe('bg');
});

test('set/delete возвращают изменившиеся имена, включая пришедшие по цепочке', () => {
  const t = table();
  const defs = new VarRoleCounter(); const links: VarLinks = [];
  collectVarUsage('--x-color', 'var(--glyph)', defs, links);
  expect([...t.set('defs', defs, links)]).toEqual([]);
  const u = new VarRoleCounter(); use(u, 'color', 'var(--x-color)');
  expect([...t.set('use', u)].sort()).toEqual(['--glyph', '--x-color']);
  expect(t.roleOf('--glyph')).toBe('text');
  expect([...t.delete('use')].sort()).toEqual(['--glyph', '--x-color']);
  expect(t.roleOf('--glyph')).toBe('bg');
  t.set('use', u);
  expect([...t.delete('defs')]).toEqual(['--glyph']);
  expect(t.roleOf('--glyph')).toBe('bg');
});

test('замена источника не удваивает счётчики (как в плане 1)', () => {
  const t = table(); const c = new VarRoleCounter(); const links: VarLinks = [];
  collectVarUsage('--b', 'var(--a)', c, links); use(c, 'color', 'var(--b)', 1, links);
  expect([...t.set('s', c, links)].sort()).toEqual(['--a', '--b']);
  expect([...t.set('s', c, links)]).toEqual([]);
  expect(t.rolesOf('--a')).toEqual(['text']);
});

test('связи дедуплицируются глобально: одна пара из двух источников и дважды в одном даёт вклад один раз', () => {
  const t = table();
  const mk = () => { const c = new VarRoleCounter(); const l: VarLinks = []; collectVarUsage('--b', 'var(--a) var(--a)', c, l); return [c, l] as const; };
  const [c1, l1] = mk(); const [c2, l2] = mk();
  const u = new VarRoleCounter(); use(u, 'color', 'var(--b)', 2); use(u, 'background-color', 'var(--a)', 1);
  t.set('d1', c1, l1); t.set('d2', c2, l2); t.set('u', u);
  expect(t.roleOf('--a')).toBe('text'); // bg 1 + text 2 (once)
  expect(t.isMixed('--a')).toBe(true); // 1/3, not 1/5
  t.delete('d1'); expect(t.roleOf('--a')).toBe('text'); // pair still declared by d2
  t.delete('d2'); expect(t.roleOf('--a')).toBe('bg'); // link gone: only bg 1
  expect(t.rolesOf('--a')).toEqual(['bg']);
});

test('роль меняется через вышестоящий источник по цепочке (кэш сбрасывается)', () => {
  const t = table(); const defs = new VarRoleCounter(); const links: VarLinks = [];
  collectVarUsage('--c', 'var(--d)', defs, links); collectVarUsage('--b', 'var(--c)', defs, links);
  t.set('defs', defs, links);
  expect(t.roleOf('--d')).toBe('bg'); // warms the cache
  const a = new VarRoleCounter(); use(a, 'border-color', 'var(--b)');
  expect([...t.set('a', a)].sort()).toEqual(['--b', '--c', '--d']);
  expect(t.roleOf('--d')).toBe('border');
  const a2 = new VarRoleCounter(); use(a2, 'color', 'var(--b)');
  expect([...t.set('a', a2)].sort()).toEqual(['--b', '--c', '--d']);
  expect(t.roleOf('--d')).toBe('text');
});
