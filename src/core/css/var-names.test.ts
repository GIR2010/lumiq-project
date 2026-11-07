import { expect, test } from 'vitest';
import { roleFromName } from './var-names';

test.each([
  ['--secondary-icon', 'text'], ['--primary-text', 'text'], ['--foreground', 'text'], ['--link-color', 'text'], ['--accent', 'text'],
  ['--card-background', 'bg'], ['--web-wash', 'bg'], ['--surface', 'bg'], ['--bg-color', 'bg'], ['--overlay', 'bg'],
  ['--divider', 'border'], ['--border-color', 'border'], ['--separator', 'border'], ['--outline', 'border'],
  ['--shadow-color', 'shadow'],
])('%s → %s', (n, r) => expect(roleFromName(n)).toBe(r));
test.each(['--su1', '--black-500', '--purple-400', '--x', '--theme-palette-blue500'])('%s → null', (n) =>
  expect(roleFromName(n)).toBeNull());
test('background важнее color/icon в одном имени', () => expect(roleFromName('--icon-background')).toBe('bg'));
