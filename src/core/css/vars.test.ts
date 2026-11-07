import { expect, test } from 'vitest';
import { VarRoleCounter, VarRoleTable, collectVarUsage } from './vars';

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
  t.clear(); expect(t.roleOf('--x')).toBe('bg');
});
test('сокращённые свойства с var() учитываются по своей роли', () => {
  const c = new VarRoleCounter();
  collectVarUsage('background', 'linear-gradient(to right,transparent,var(--surf,#fff))', c);
  collectVarUsage('border', '1px solid var(--line)', c);
  expect(c.roleOf('--surf')).toBe('bg');
  expect(c.roleOf('--line')).toBe('border');
});
