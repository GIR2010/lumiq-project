import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fetchCss, resetCssCache } from './css-fetch';

beforeEach(() => resetCssCache());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('кэш, credentials omit, ошибки схемы и статуса', async () => {
  const f = vi.fn(async (..._a: unknown[]) => new Response('a{color:red}', { status: 200 })); vi.stubGlobal('fetch', f);
  expect(await fetchCss('https://cdn.x/a.css')).toBe('a{color:red}');
  await fetchCss('https://cdn.x/a.css'); expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
  await expect(fetchCss('data:text/css,a{}')).rejects.toThrow('unsupported scheme');
  f.mockResolvedValueOnce(new Response('', { status: 404 })); await expect(fetchCss('https://cdn.x/b.css')).rejects.toThrow();
});

test('неудачный запрос не кэшируется', async () => {
  const f = vi.fn(async (..._a: unknown[]) => new Response('ok', { status: 200 })); vi.stubGlobal('fetch', f);
  f.mockResolvedValueOnce(new Response('', { status: 500 }));
  await expect(fetchCss('https://cdn.x/c.css')).rejects.toThrow();
  expect(await fetchCss('https://cdn.x/c.css')).toBe('ok');
});

test('таймаут 10 с прерывает запрос', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_u: unknown, init: RequestInit) => new Promise((_, rej) => {
    init.signal!.addEventListener('abort', () => rej(new Error('aborted')));
  })));
  const assertion = expect(fetchCss('https://cdn.x/slow.css')).rejects.toThrow('aborted');
  await vi.advanceTimersByTimeAsync(10_000);
  await assertion;
});
