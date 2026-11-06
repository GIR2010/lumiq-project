import { expect, test } from 'vitest';
import { DEFAULT_GLOBAL } from './defaults';
import { computeRegistration } from './registration';

const g = DEFAULT_GLOBAL;
test('def on: all sites except disabled ones', () => {
  expect(computeRegistration({ ...g, def: 'on' }, { 'a.com': { on: false }, 'b.com': { det: true } }))
    .toEqual({ file: 'placeholder.js', matches: ['<all_urls>'], excludeMatches: ['*://a.com/*', '*://www.a.com/*'] });
});
test('def off: only enabled sites; sys → sys file', () => {
  expect(computeRegistration({ ...g, def: 'off', sys: true }, { 'a.com': { on: true }, 'b.com': {} }))
    .toEqual({ file: 'placeholder-sys.js', matches: ['*://a.com/*', '*://www.a.com/*'], excludeMatches: [] });
});
test('def off without enabled sites → null', () => expect(computeRegistration({ ...g, def: 'off' }, {})).toBeNull());
test('host starting with www. gets a single pattern', () => {
  expect(computeRegistration({ ...g, def: 'off' }, { 'www.a.com': { on: true } })?.matches).toEqual(['*://www.a.com/*']);
});
test('IP hosts get no www. variant (it is not a valid match-pattern host)', () => {
  expect(computeRegistration({ ...g, def: 'on' }, { '127.0.0.1': { on: false } })?.excludeMatches).toEqual(['*://127.0.0.1/*']);
  expect(computeRegistration({ ...g, def: 'off' }, { '10.0.0.2': { on: true }, '[::1]': { on: true } })?.matches)
    .toEqual(['*://10.0.0.2/*', '*://[::1]/*']);
});
