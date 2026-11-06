import { expect, test } from 'vitest';
import { VarRoleCounter, collectVarUsage } from './vars';

test('преобладающая роль и умолчание bg', () => {
  const c = new VarRoleCounter();
  collectVarUsage('color', 'var(--fg)', c); collectVarUsage('border-top-color', 'var(--fg)', c); collectVarUsage('color', 'var(--fg)', c);
  expect(c.roleOf('--fg')).toBe('text'); expect(c.roleOf('--unknown')).toBe('bg');
});
