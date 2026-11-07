import { expect, test } from 'vitest';
import { classifyDarkness } from './detect';

const s = (l: number) => Array(9).fill({ l, c: 0, h: 0, alpha: 1 });
test.each([
  [0.2, 'normal', null, false, 'dark'], [0.95, 'normal', null, true, 'light'],
  [0.5, 'dark', null, false, 'dark'], [0.5, 'normal', 'light dark', true, 'dark'],
  [0.5, 'normal', 'light dark', false, 'unsure'], [0.95, 'dark', null, true, 'light'],
] as const)('L=%s scheme=%s meta=%s sys=%s → %s', (l, cs, ms, sd, r) =>
  expect(classifyDarkness({ samples: s(l), colorScheme: cs, metaScheme: ms, systemDark: sd })).toBe(r));
