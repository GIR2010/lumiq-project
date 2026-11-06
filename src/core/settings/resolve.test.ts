import { expect, test } from 'vitest';
import { DEFAULT_GLOBAL } from './defaults';
import type { SiteSettings } from './schema';
import { resolveConfig, shouldApply, siteKey } from './resolve';

test.each([
  ['https://www.Example.com/a', 'example.com'], ['http://mail.google.com', 'mail.google.com'],
  ['chrome://extensions', null], ['file:///c:/x.html', null], ['not a url', null],
])('siteKey(%s) = %s', (u, k) => expect(siteKey(u)).toBe(k));

const g = DEFAULT_GLOBAL;
const env = (systemDark = true, pageIsDark: boolean | null = false) => ({ systemDark, pageIsDark });
test.each([
  // [def, site, sys, systemDark, pageIsDark, apply, status]
  ['on',  {},                 false, true,  false, true,  'active'],
  ['on',  { on: false },      false, true,  false, false, 'off'],
  ['off', {},                 false, true,  false, false, 'off'],
  ['off', { on: true },       false, true,  false, true,  'active'],
  ['on',  {},                 true,  false, false, false, 'system-light'],
  ['on',  {},                 true,  true,  false, true,  'active'],
  ['on',  {},                 false, true,  true,  false, 'already-dark'],
  ['on',  { det: true },      false, true,  true,  true,  'active'],
  ['on',  { on: false },      true,  false, true,  false, 'off'],      // rule 1 before 3 and 4
  ['on',  {},                 false, true,  null,  true,  'active'],
] as const)('def=%s site=%j sys=%s sd=%s dark=%s → %s/%s', (def, site, sys, sd, dark, apply, status) => {
  const cfg = resolveConfig('x.com', { ...g, def, sys }, site as SiteSettings, []);
  expect(shouldApply(cfg, env(sd, dark))).toEqual({ apply, status });
});
test('site adj overrides field by field', () => {
  expect(resolveConfig('x.com', g, { adj: { br: 80 } }, []).adj).toEqual({ ...g.adj, br: 80 });
});
