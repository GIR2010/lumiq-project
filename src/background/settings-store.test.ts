import { afterEach, beforeEach, expect, test, vi, type Mock } from 'vitest';
import { installFakeChrome } from '../../tests/fakes/chrome';
import { SettingsStore } from './settings-store';
import { DEFAULT_GLOBAL } from '../core/settings/defaults';

beforeEach(() => { installFakeChrome(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const emit = (changes: Record<string, unknown>, area = 'sync') =>
  (chrome.storage.onChanged as any).emit(changes, area);

test('пустое хранилище → умолчания', async () => {
  const s = new SettingsStore(); await s.ready; expect(s.snapshot().g).toEqual(DEFAULT_GLOBAL);
});

test('10 быстрых изменений → одна запись с последним значением, 10 уведомлений', async () => {
  const s = new SettingsStore(); await s.ready; const cb = vi.fn(); s.onChange(cb);
  for (let i = 0; i < 10; i++) s.updateGlobal({ adj: { ...DEFAULT_GLOBAL.adj, br: 100 + i } });
  expect(cb).toHaveBeenCalledTimes(10);
  await vi.advanceTimersByTimeAsync(500);
  expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);
  expect((chrome.storage.sync.set as Mock).mock.calls[0][0].g.adj.br).toBe(109);
});

test('updateSite(null) удаляет ключ s:<host>', async () => {
  await chrome.storage.sync.set({ 's:a.com': { on: true } });
  const s = new SettingsStore(); await s.ready; s.updateSite('a.com', null);
  await vi.advanceTimersByTimeAsync(500);
  expect(chrome.storage.sync.remove).toHaveBeenCalledWith('s:a.com');
  expect(s.snapshot().sites['a.com']).toBeUndefined();
});

test('патч, опустошающий сайт, удаляет ключ', async () => {
  await chrome.storage.sync.set({ 's:a.com': { on: true } });
  const s = new SettingsStore(); await s.ready; s.updateSite('a.com', { on: null });
  await vi.advanceTimersByTimeAsync(500);
  expect(chrome.storage.sync.remove).toHaveBeenCalledWith('s:a.com');
});

test('невалидная запись сайта отбрасывается', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await chrome.storage.sync.set({ 's:bad.com': { on: 'yes' } });
  const s = new SettingsStore(); await s.ready; expect(s.snapshot().sites['bad.com']).toBeUndefined();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DarkExt]'));
});

test('ключ с некорректным хостом отбрасывается', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await chrome.storage.sync.set({ 's:bad/host': { on: true }, 's:ok.com': { on: true } });
  const s = new SettingsStore(); await s.ready;
  expect(Object.keys(s.snapshot().sites)).toEqual(['ok.com']);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DarkExt]'));
});

test('внешнее изменение с другого устройства → onChange', async () => {
  const s = new SettingsStore(); await s.ready; const cb = vi.fn(); s.onChange(cb);
  emit({ 's:x.com': { newValue: { on: false } } });
  await vi.runAllTimersAsync();
  expect(s.snapshot().sites['x.com']).toEqual({ on: false }); expect(cb).toHaveBeenCalled();
});

test('эхо собственной записи игнорируется', async () => {
  const s = new SettingsStore(); await s.ready;
  const cb = vi.fn(); s.onChange(cb);
  s.updateSite("a.com", { on: true });
  cb.mockClear();
  await vi.advanceTimersByTimeAsync(500); // fake storage echoes the write via onChanged
  expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);
  expect(cb).not.toHaveBeenCalled();
});

test('внешнее удаление ключа убирает сайт', async () => {
  await chrome.storage.sync.set({ 's:a.com': { on: true } });
  const s = new SettingsStore(); await s.ready; const cb = vi.fn(); s.onChange(cb);
  emit({ 's:a.com': { oldValue: { on: true } } });
  await vi.runAllTimersAsync();
  expect(s.snapshot().sites['a.com']).toBeUndefined(); expect(cb).toHaveBeenCalled();
});

test('flush() пишет всё немедленно', async () => {
  const s = new SettingsStore(); await s.ready;
  s.updateGlobal({ sys: true }); s.updateSite('a.com', { on: true });
  await s.flush();
  expect(((await chrome.storage.sync.get('g')) as any).g.sys).toBe(true);
  expect((await chrome.storage.sync.get('s:a.com'))['s:a.com']).toEqual({ on: true });
});

test('сбой загрузки: ready резолвится, умолчания, warn', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  (chrome.storage.sync.get as Mock).mockRejectedValueOnce(new Error('boom'));
  const s = new SettingsStore(); await s.ready;
  expect(s.snapshot().g).toEqual(DEFAULT_GLOBAL);
  expect(warn).toHaveBeenCalledWith('[DarkExt] settings load failed', expect.any(Error));
});

test('updateGlobal до ready не затирается загрузкой', async () => {
  await chrome.storage.sync.set({ g: { ...DEFAULT_GLOBAL, sys: false, def: 'off' } });
  const s = new SettingsStore();
  s.updateGlobal({ def: 'on' });
  await s.ready;
  expect(s.snapshot().g.def).toBe('on');
});

test('эхо потребляется один раз: позднее внешнее значение, равное старой записи, применяется', async () => {
  const s = new SettingsStore(); await s.ready;
  s.updateSite('a.com', { on: true });
  await vi.advanceTimersByTimeAsync(500);
  emit({ 's:a.com': { newValue: { on: false } } });
  expect(s.snapshot().sites['a.com']).toEqual({ on: false });
  emit({ 's:a.com': { newValue: { on: true } } });
  expect(s.snapshot().sites['a.com']).toEqual({ on: true });
});

test('внешнее изменение при отложенной записи игнорируется', async () => {
  const s = new SettingsStore(); await s.ready;
  s.updateSite('a.com', { on: true });
  emit({ 's:a.com': { newValue: { on: false } } });
  await vi.advanceTimersByTimeAsync(500);
  expect(s.snapshot().sites['a.com']).toEqual({ on: true });
  expect((await chrome.storage.sync.get('s:a.com'))['s:a.com']).toEqual({ on: true });
});

test('сбой записи: warn, без необработанного отказа, flush резолвится', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const s = new SettingsStore(); await s.ready;
  (chrome.storage.sync.set as Mock).mockRejectedValueOnce(new Error('quota'));
  s.updateGlobal({ sys: true });
  await expect(s.flush()).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith('[DarkExt] settings write failed', 'g', expect.any(Error));
});
