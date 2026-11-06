import { expect, test } from 'vitest';
import { installFakeChrome } from '../../tests/fakes/chrome';
import { SettingsStore } from './settings-store';
import { handleCommand } from './commands';

test('toggle-site инвертирует итоговое включение; toggle-global меняет def', async () => {
  installFakeChrome(); const store = new SettingsStore(); await store.ready;
  handleCommand('toggle-site', { url: 'https://a.com/' } as chrome.tabs.Tab, store);
  expect(store.snapshot().sites['a.com']).toEqual({ on: false });
  handleCommand('toggle-site', { url: 'https://a.com/' } as chrome.tabs.Tab, store);
  expect(store.snapshot().sites['a.com']).toEqual({ on: true });
  handleCommand('toggle-global', undefined, store); expect(store.snapshot().g.def).toBe('off');
  handleCommand('toggle-global', undefined, store); expect(store.snapshot().g.def).toBe('on');
  const before = JSON.stringify(store.snapshot());
  handleCommand('toggle-site', { url: 'chrome://x' } as chrome.tabs.Tab, store); // без эффекта и без исключения
  handleCommand('toggle-site', undefined, store);
  expect(JSON.stringify(store.snapshot())).toBe(before);
});
