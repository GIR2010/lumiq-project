import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installFakeChrome } from '../../tests/fakes/chrome';
import { SettingsStore } from './settings-store';
import { TabStateStore } from './tab-state';
import { createRouter, broadcast } from './router';
import { SentConfigs } from './sent-configs';

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

describe('I2: дедупликация CONFIG_CHANGED по вкладкам', () => {
  test('та же конфигурация не отправляется повторно; кэш сбрасывают GET_CONFIG, навигация и закрытие вкладки', async () => {
    const store = new SettingsStore(); await store.ready;
    const sent = new SentConfigs();
    const r = createRouter(store, new TabStateStore(), sent);
    fake.tabs.query.mockResolvedValue([{ id: 7, url: 'https://a.com/' }]);
    await broadcast(store, sent);
    await broadcast(store, sent);
    expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(1);
    store.updateSite('b.com', { on: false }); // another site: a.com's config is unchanged
    await broadcast(store, sent);
    expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(1);
    store.updateSite('a.com', { on: false });
    await broadcast(store, sent);
    expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(2);
    await r({ type: 'GET_CONFIG' }, sender('https://a.com/')); // a fresh content script in tab 7
    await broadcast(store, sent);
    expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(3);
    fake.tabs.onUpdated.emit(7, { status: 'loading' });
    await broadcast(store, sent);
    expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(4);
    fake.tabs.onRemoved.emit(7);
    await broadcast(store, sent);
    expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(5);
  });

  test('неудачная отправка не запоминается', async () => {
    const store = new SettingsStore(); await store.ready;
    const sent = new SentConfigs();
    fake.tabs.query.mockResolvedValue([{ id: 7, url: 'https://a.com/' }]);
    fake.tabs.sendMessage.mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'));
    await broadcast(store, sent);
    await broadcast(store, sent);
    expect(fake.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });
});

test('M9: невалидные патчи UPDATE_GLOBAL / UPDATE_SITE → warn и { error }, хранилище не меняется', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const store = new SettingsStore(); await store.ready; const r = createRouter(store, new TabStateStore());
  const before = structuredClone(store.snapshot());
  const bad = [
    { type: 'UPDATE_GLOBAL', patch: { def: 'maybe' } },
    { type: 'UPDATE_GLOBAL', patch: { adj: { br: 999 } } },
    { type: 'UPDATE_GLOBAL', patch: { evil: 1 } },
    { type: 'UPDATE_GLOBAL', patch: null },
    { type: 'UPDATE_SITE', host: 'a.com', patch: { on: 'yes' } },
    { type: 'UPDATE_SITE', host: 'a.com', patch: { adj: { gs: -5 } } },
    { type: 'UPDATE_SITE', host: 'a.com', patch: { extra: true } },
    { type: 'UPDATE_SITE', host: 'bad/host', patch: { on: true } },
    { type: 'UPDATE_SITE', host: 'www.a.com', patch: { on: true } },
  ];
  for (const m of bad) expect(await r(m as never, sender('https://a.com'))).toEqual({ error: 'invalid patch' });
  expect(store.snapshot()).toEqual(before);
  expect(warn).toHaveBeenCalledTimes(bad.length);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DarkExt]'), expect.anything());
  // Valid partial patches still apply.
  await r({ type: 'UPDATE_GLOBAL', patch: { adj: { br: 90 } as never } }, sender('https://a.com'));
  expect(store.snapshot().g.adj.br).toBe(90);
  await r({ type: 'UPDATE_SITE', host: 'a.com', patch: { adj: { ct: 80 }, st: 'oled' } }, sender('https://a.com'));
  await r({ type: 'UPDATE_SITE', host: 'a.com', patch: { st: null, adj: null } }, sender('https://a.com'));
  expect(store.snapshot().sites['a.com']).toBeUndefined();
  await r({ type: 'UPDATE_SITE', host: 'a.com', patch: { on: false } }, sender('https://a.com'));
  await r({ type: 'UPDATE_SITE', host: 'a.com', patch: null }, sender('https://a.com'));
  expect(store.snapshot().sites['a.com']).toBeUndefined();
  warn.mockRestore();
});
