import { beforeEach, expect, test, vi } from 'vitest';
import { installFakeChrome, type FakeChrome } from '../../tests/fakes/chrome';
import { DEFAULT_GLOBAL } from '../core/settings/defaults';

let fake: FakeChrome;
beforeEach(() => { fake = installFakeChrome(); vi.resetModules(); });
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

test('I1: пробуждение service worker не рассылает CONFIG_CHANGED; регистрация заглушки синхронизируется', async () => {
  await chrome.storage.sync.set({ g: { ...DEFAULT_GLOBAL, def: 'off' }, 's:a.com': { on: true } });
  fake.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.com/' }]);
  await import('./index');
  await flush();
  expect(fake.tabs.sendMessage).not.toHaveBeenCalled();
  expect(fake.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
});

test('изменение настроек → CONFIG_CHANGED во вкладку и обновление регистрации', async () => {
  fake.tabs.query.mockResolvedValue([{ id: 1, url: 'https://a.com/' }]);
  await import('./index');
  await flush();
  fake.storage.onChanged.emit({ 's:a.com': { newValue: { on: false } } }, 'sync');
  await flush();
  expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(1);
  expect(fake.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'CONFIG_CHANGED', config: expect.objectContaining({ host: 'a.com', enabled: false }) }));
  expect(fake.scripting.updateContentScripts).toHaveBeenCalledTimes(1);
});
