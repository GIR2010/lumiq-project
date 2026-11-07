import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fetchCss, resetCssCache } from './css-fetch';

const CSS = { 'content-type': 'text/css' };
const css = (body: BodyInit | null, init: ResponseInit = {}) => new Response(body, { status: 200, ...init, headers: { ...CSS, ...(init.headers as Record<string, string> | undefined) } });

beforeEach(() => resetCssCache());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('кэш, credentials omit, ошибки схемы и статуса', async () => {
  const f = vi.fn(async (..._a: unknown[]) => css('a{color:red}')); vi.stubGlobal('fetch', f);
  expect(await fetchCss('https://cdn.x/a.css')).toBe('a{color:red}');
  await fetchCss('https://cdn.x/a.css'); expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
  await expect(fetchCss('data:text/css,a{}')).rejects.toThrow('unsupported scheme');
  f.mockResolvedValueOnce(css('', { status: 404 })); await expect(fetchCss('https://cdn.x/b.css')).rejects.toThrow();
});

test('неудачный запрос не кэшируется', async () => {
  const f = vi.fn(async (..._a: unknown[]) => css('ok')); vi.stubGlobal('fetch', f);
  f.mockResolvedValueOnce(css('', { status: 500 }));
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

test('I4: ответ без content-type text/css отклоняется (параметры и регистр не важны)', async () => {
  const f = vi.fn(async (..._a: unknown[]) => new Response('a{}', { status: 200, headers: { 'content-type': 'text/html' } }));
  vi.stubGlobal('fetch', f);
  await expect(fetchCss('https://cdn.x/page.css')).rejects.toThrow('not CSS');
  f.mockResolvedValueOnce(new Response('a{}', { status: 200, headers: { 'content-type': 'Text/CSS; charset=utf-8' } }));
  expect(await fetchCss('https://cdn.x/ok.css')).toBe('a{}');
  f.mockResolvedValueOnce(new Response('a{}', { status: 200 })); // text/plain by default
  await expect(fetchCss('https://cdn.x/plain.css')).rejects.toThrow('not CSS');
});

test('I4: Content-Length больше 5 МБ отклоняется', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => css('a{}', { headers: { 'content-length': String(5 * 1024 * 1024 + 1) } })));
  await expect(fetchCss('https://cdn.x/huge.css')).rejects.toThrow('too large');
});

test('I4: тело больше 5 МБ без Content-Length: чтение прекращается, отказ', async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(97);
  let pulled = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) { pulled++; c.enqueue(chunk); }, // endless stream
    cancel() { cancelled = true; },
  });
  vi.stubGlobal('fetch', vi.fn(async () => css(body)));
  await expect(fetchCss('https://cdn.x/stream.css')).rejects.toThrow('too large');
  expect(cancelled).toBe(true);
  expect(pulled).toBeLessThan(10);
});

test('I4: кэш — LRU на 100 записей', async () => {
  const f = vi.fn(async (u: unknown) => css(String(u))); vi.stubGlobal('fetch', f);
  const url = (i: number) => `https://cdn.x/${i}.css`;
  for (let i = 0; i < 100; i++) await fetchCss(url(i));
  await fetchCss(url(0)); // recently used again: moves to the newest end
  await fetchCss(url(100)); // 101st entry evicts the oldest: url(1)
  expect(f).toHaveBeenCalledTimes(101);
  await fetchCss(url(0));
  expect(f).toHaveBeenCalledTimes(101);
  await fetchCss(url(1));
  expect(f).toHaveBeenCalledTimes(102);
});
