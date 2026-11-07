import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fetchImage, resetImageCache } from './image-fetch';

const MB = 1024 * 1024;
const img = (body: BodyInit | Uint8Array | null, type = 'image/png', init: ResponseInit = {}) =>
  new Response(body as BodyInit | null, { status: 200, ...init, headers: { 'content-type': type, ...(init.headers as Record<string, string> | undefined) } });
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

beforeEach(() => resetImageCache());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('успешный PNG: dataUrl, animated false, credentials omit', async () => {
  const f = vi.fn(async (..._a: unknown[]) => img(PNG)); vi.stubGlobal('fetch', f);
  const r = await fetchImage('https://cdn.x/a.png');
  expect(r.dataUrl).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`);
  expect(r.animated).toBe(false);
  expect(f.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
});

test('mime без параметров, регистр не важен; svg разрешён', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => img('<svg/>', 'Image/SVG+XML; charset=utf-8')));
  expect((await fetchImage('https://cdn.x/a.svg')).dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
});

test('не image/* отклоняется', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => img('<html>', 'text/html')));
  await expect(fetchImage('https://cdn.x/p')).rejects.toThrow('not an image');
});

test('ошибка HTTP', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => img('', 'image/png', { status: 404 })));
  await expect(fetchImage('https://cdn.x/404.png')).rejects.toThrow('HTTP 404');
});

test('Content-Length больше 1 МБ отклоняется', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => img(PNG, 'image/png', { headers: { 'content-length': String(MB + 1) } })));
  await expect(fetchImage('https://cdn.x/huge.png')).rejects.toThrow('too large');
});

test('потоковое превышение 1 МБ: отказ и cancel', async () => {
  const chunk = new Uint8Array(MB / 2).fill(1);
  let pulled = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(chunk); }, cancel() { cancelled = true; } });
  vi.stubGlobal('fetch', vi.fn(async () => img(body)));
  await expect(fetchImage('https://cdn.x/stream.png')).rejects.toThrow('too large');
  expect(cancelled).toBe(true);
  expect(pulled).toBeLessThan(10);
});

test('ровно 1 МБ проходит (без переполнения стека при кодировании)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => img(new Uint8Array(MB).fill(7))));
  const r = await fetchImage('https://cdn.x/edge.png');
  expect(r.dataUrl.length).toBeGreaterThan(MB);
});

test.each(['file:///a.png', 'chrome-extension://abc/a.png', 'data:image/png;base64,AAAA'])('схема %s: unsupported scheme', async (u) => {
  const f = vi.fn(); vi.stubGlobal('fetch', f);
  await expect(fetchImage(u)).rejects.toThrow('unsupported scheme');
  expect(f).not.toHaveBeenCalled();
});

test('кэш: второй вызов без запроса; ошибка не кэшируется', async () => {
  const f = vi.fn(async (..._a: unknown[]) => img(PNG)); vi.stubGlobal('fetch', f);
  await fetchImage('https://cdn.x/c.png'); await fetchImage('https://cdn.x/c.png');
  expect(f).toHaveBeenCalledTimes(1);
  f.mockResolvedValueOnce(img('', 'image/png', { status: 500 }));
  await expect(fetchImage('https://cdn.x/e.png')).rejects.toThrow();
  await fetchImage('https://cdn.x/e.png');
  expect(f).toHaveBeenCalledTimes(3);
});

test('кэш — LRU на 100 записей', async () => {
  const f = vi.fn(async () => img(PNG)); vi.stubGlobal('fetch', f);
  const url = (i: number) => `https://cdn.x/${i}.png`;
  for (let i = 0; i < 100; i++) await fetchImage(url(i));
  await fetchImage(url(0));
  await fetchImage(url(100)); // evicts url(1)
  expect(f).toHaveBeenCalledTimes(101);
  await fetchImage(url(0));
  expect(f).toHaveBeenCalledTimes(101);
  await fetchImage(url(1));
  expect(f).toHaveBeenCalledTimes(102);
});

test('таймаут 10 с прерывает запрос', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_u: unknown, init: RequestInit) => new Promise((_, rej) => {
    init.signal!.addEventListener('abort', () => rej(new Error('aborted')));
  })));
  const assertion = expect(fetchImage('https://cdn.x/slow.png')).rejects.toThrow('aborted');
  await vi.advanceTimersByTimeAsync(10_000);
  await assertion;
});

// GIF89a header + logical screen descriptor (no color table) + N minimal image blocks + trailer.
function gif(frames: number): Uint8Array {
  const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0];
  for (let i = 0; i < frames; i++) out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0);
  out.push(0x3b);
  return new Uint8Array(out);
}

test('GIF с 2 кадрами: animated true; с 1 кадром и не-GIF: false', async () => {
  const f = vi.fn(async (..._a: unknown[]) => img(gif(2), 'image/gif')); vi.stubGlobal('fetch', f);
  expect((await fetchImage('https://cdn.x/2.gif')).animated).toBe(true);
  f.mockResolvedValueOnce(img(gif(1), 'image/gif'));
  expect((await fetchImage('https://cdn.x/1.gif')).animated).toBe(false);
  f.mockResolvedValueOnce(img(gif(2), 'image/png'));
  expect((await fetchImage('https://cdn.x/fake.png')).animated).toBe(false);
});
