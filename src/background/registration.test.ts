import { beforeEach, expect, test, vi } from 'vitest';
import { installFakeChrome } from '../../tests/fakes/chrome';
import type { Registration } from '../core/settings/registration';
import { syncRegistration, resetRegistrationCache } from './registration';

const reg: Registration = { file: 'placeholder.js', matches: ['<all_urls>'], excludeMatches: [] };
const asScript = (r: { file: string; matches: string[]; excludeMatches: string[] }) => ({
  id: 'darkext-placeholder', js: [r.file], matches: r.matches, excludeMatches: r.excludeMatches,
  runAt: 'document_start', allFrames: false, persistAcrossSessions: true,
});
let fake: ReturnType<typeof installFakeChrome>;
beforeEach(() => { fake = installFakeChrome(); resetRegistrationCache(); });

test('register → update → unregister; повтор без изменений не вызывает API', async () => {
  await syncRegistration(reg); expect(chrome.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
  expect(fake.scripting.registerContentScripts).toHaveBeenCalledWith([asScript(reg)]);
  await syncRegistration(reg); expect(chrome.scripting.updateContentScripts).not.toHaveBeenCalled();
  expect(chrome.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
  await syncRegistration({ ...reg, excludeMatches: ['*://a.com/*'] }); expect(chrome.scripting.updateContentScripts).toHaveBeenCalledTimes(1);
  await syncRegistration(null); expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['darkext-placeholder'] });
});

test('после рестарта worker: уже зарегистрированный идентичный скрипт — no-op', async () => {
  fake.scripting.getRegisteredContentScripts.mockResolvedValueOnce([asScript(reg)]);
  await syncRegistration(reg);
  expect(fake.scripting.getRegisteredContentScripts).toHaveBeenCalledWith({ ids: ['darkext-placeholder'] });
  expect(fake.scripting.registerContentScripts).not.toHaveBeenCalled();
  expect(fake.scripting.updateContentScripts).not.toHaveBeenCalled();
});

test('после рестарта worker: другой набор — update, а не register', async () => {
  fake.scripting.getRegisteredContentScripts.mockResolvedValueOnce([asScript(reg)]);
  await syncRegistration({ ...reg, excludeMatches: ['*://a.com/*'] });
  expect(fake.scripting.updateContentScripts).toHaveBeenCalledTimes(1);
  expect(fake.scripting.registerContentScripts).not.toHaveBeenCalled();
});

test('после рестарта worker: null при существующей регистрации — unregister', async () => {
  fake.scripting.getRegisteredContentScripts.mockResolvedValueOnce([asScript(reg)]);
  await syncRegistration(null);
  expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['darkext-placeholder'] });
});

test('null без существующей регистрации — не вызывает unregister', async () => {
  await syncRegistration(null);
  expect(fake.scripting.unregisterContentScripts).not.toHaveBeenCalled();
});

test('сбой API не бросает исключение', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake.scripting.registerContentScripts.mockRejectedValueOnce(new Error('x'));
  await expect(syncRegistration(reg)).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
