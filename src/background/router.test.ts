import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installFakeChrome } from '../../tests/fakes/chrome';
import { SettingsStore } from './settings-store';
import { TabStateStore } from './tab-state';
import { createRouter, broadcast } from './router';

let fake: ReturnType<typeof installFakeChrome>;
beforeEach(() => { fake = installFakeChrome(); });
const sender = (url: string, frameId = 0) => ({ tab: { id: 7, url } as chrome.tabs.Tab, frameId });

test('GET_CONFIG: конфигурация по URL вкладки; для chrome:// — null', async () => {
  const store = new SettingsStore(); await store.ready; const r = createRouter(store, new TabStateStore());
  expect(await r({ type: 'GET_CONFIG' }, sender('https://www.a.com/x'))).toMatchObject({ host: 'a.com', enabled: true, engine: 'adaptive' });
  expect(await r({ type: 'GET_CONFIG' }, sender('chrome://settings'))).toBeNull();
});

test('REPORT_STATE из iframe игнорируется, из верхнего фрейма — сохраняется и ставит значок', async () => {
  const store = new SettingsStore(); await store.ready; const tabs = new TabStateStore(); const r = createRouter(store, tabs);
  await r({ type: 'REPORT_STATE', state: { status: 'already-dark', detectedDark: true } }, sender('https://a.com', 3));
  expect(await tabs.get(7)).toBeUndefined();
  await r({ type: 'REPORT_STATE', state: { status: 'already-dark', detectedDark: true } }, sender('https://a.com'));
  expect(await tabs.get(7)).toEqual({ status: 'already-dark', detectedDark: true });
  expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: 'auto' });
});

test('GET_TAB_STATE: host, состояние по умолчанию, unsupported для chrome://', async () => {
  const store = new SettingsStore(); await store.ready; const tabs = new TabStateStore(); const r = createRouter(store, tabs);
  fake.tabs.get.mockResolvedValueOnce({ url: 'https://www.a.com/p' });
  const s = await r({ type: 'GET_TAB_STATE', tabId: 7 }, sender('https://a.com')) as any;
  expect(s.host).toBe('a.com');
  expect(s.state).toEqual({ status: 'off', detectedDark: false });
  expect(s.snapshot).toEqual(store.snapshot());
  fake.tabs.get.mockResolvedValueOnce({ url: 'chrome://x' });
  const u = await r({ type: 'GET_TAB_STATE', tabId: 8 }, sender('https://a.com')) as any;
  expect(u.host).toBeNull();
  expect(u.state).toEqual({ status: 'unsupported', detectedDark: false });
});

test('GET_TAB_STATE: возвращает сохранённое состояние; ошибка tabs.get не ломает ответ', async () => {
  const store = new SettingsStore(); await store.ready; const tabs = new TabStateStore(); const r = createRouter(store, tabs);
  await tabs.set(7, { status: 'heavy', detectedDark: false });
  fake.tabs.get.mockResolvedValueOnce({ url: 'https://a.com' });
  expect(((await r({ type: 'GET_TAB_STATE', tabId: 7 }, sender('https://a.com'))) as any).state.status).toBe('heavy');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  fake.tabs.get.mockRejectedValueOnce(new Error('No tab'));
  expect(((await r({ type: 'GET_TAB_STATE', tabId: 9 }, sender('https://a.com'))) as any).host).toBeNull();
  warn.mockRestore();
});

test('UPDATE_GLOBAL / UPDATE_SITE обновляют хранилище', async () => {
  const store = new SettingsStore(); await store.ready; const r = createRouter(store, new TabStateStore());
  await r({ type: 'UPDATE_GLOBAL', patch: { def: 'off' } }, sender('https://a.com'));
  expect(store.snapshot().g.def).toBe('off');
  await r({ type: 'UPDATE_SITE', host: 'a.com', patch: { on: true } }, sender('https://a.com'));
  expect(store.snapshot().sites['a.com']).toEqual({ on: true });
});

test('FETCH_CSS: ошибка превращается в { error }', async () => {
  const store = new SettingsStore(); await store.ready; const r = createRouter(store, new TabStateStore());
  expect(await r({ type: 'FETCH_CSS', url: 'data:text/css,a{}' }, sender('https://a.com'))).toEqual({ error: 'unsupported scheme' });
});

describe('broadcast', () => {
  test('шлёт CONFIG_CHANGED только поддерживаемым вкладкам', async () => {
    const store = new SettingsStore(); await store.ready;
    fake.tabs.query.mockResolvedValueOnce([
      { id: 1, url: 'https://a.com/' }, { id: 2, url: 'chrome://x' }, { id: 3 },
    ]);
    await broadcast(store);
    expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'CONFIG_CHANGED', config: expect.objectContaining({ host: 'a.com' }) }));
  });

  test('ошибки «нет получателя» молча игнорируются, прочие — warn, цикл продолжается', async () => {
    const store = new SettingsStore(); await store.ready;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://a.com/' }, { id: 2, url: 'https://b.com/' }, { id: 3, url: 'https://c.com/' }]);
    fake.tabs.sendMessage
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockRejectedValueOnce(new Error('boom'));
    await broadcast(store);
    expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('сбой tabs.query не бросает', async () => {
    const store = new SettingsStore(); await store.ready;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.tabs.query.mockRejectedValueOnce(new Error('x'));
    await expect(broadcast(store)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
