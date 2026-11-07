import { afterEach, expect, test, vi } from 'vitest';
import { ImageAnalyzer, type ImageDeps } from './images';

const W = 8, H = 8;
/** Left half opaque (black or white), right half transparent. */
function iconPixels(dark: boolean): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  const v = dark ? 0 : 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) {
    const p = (y * W + x) * 4;
    px[p] = v; px[p + 1] = v; px[p + 2] = v; px[p + 3] = 255;
  }
  return px;
}

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** URLs containing "dark" decode to a dark icon, otherwise to a light one; "anim" → animated. */
function fakeDeps(over: Partial<ImageDeps> = {}) {
  const deps = {
    fetchImage: vi.fn(async (url: string) => ({
      dataUrl: `data:image/png;base64,${url.includes('dark') ? 'DARK' : 'LIGHT'}`,
      animated: url.includes('anim'),
    })),
    decode: vi.fn(async (dataUrl: string) => {
      const pixels = iconPixels(dataUrl.includes('DARK'));
      return { width: W, height: H, pixels, full: () => ({ width: W, height: H, pixels }) };
    }),
    encode: vi.fn((_w: number, _h: number, _p: Uint8ClampedArray) => 'data:image/png;base64,INV'),
    ...over,
  };
  return deps;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => { vi.restoreAllMocks(); });

test('dark-icon: get возвращает вердикт и инвертированную копию data:image/png', async () => {
  const deps = fakeDeps();
  const a = new ImageAnalyzer(deps);
  expect(a.get('https://x/dark.png')).toBeUndefined();
  const r = await a.request('https://x/dark.png');
  expect(r.verdict).toBe('dark-icon');
  expect(r.animated).toBe(false);
  expect(r.inverted).toMatch(/^data:image\/png/);
  expect(a.get('https://x/dark.png')).toEqual(r);
  expect(deps.encode).toHaveBeenCalledWith(W, H, expect.any(Uint8ClampedArray));
});

test('other: inverted отсутствует, encode не вызывается', async () => {
  const deps = fakeDeps();
  const a = new ImageAnalyzer(deps);
  const r = await a.request('https://x/light.png');
  expect(r).toEqual({ verdict: 'other', animated: false });
  expect(r.inverted).toBeUndefined();
  expect(deps.encode).not.toHaveBeenCalled();
});

test('10 одновременных request одного URL → один fetchImage, один onResult', async () => {
  const deps = fakeDeps();
  const a = new ImageAnalyzer(deps);
  const cb = vi.fn();
  a.onResult(cb);
  const rs = await Promise.all(Array.from({ length: 10 }, () => a.request('https://x/dark.png')));
  expect(deps.fetchImage).toHaveBeenCalledTimes(1);
  expect(new Set(rs.map((r) => r.verdict))).toEqual(new Set(['dark-icon']));
  await a.request('https://x/dark.png'); // from cache
  expect(deps.fetchImage).toHaveBeenCalledTimes(1);
  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb).toHaveBeenCalledWith('https://x/dark.png', rs[0]);
});

test('ошибка fetchImage → other без отклонения, console.debug, без повторов', async () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const deps = fakeDeps({ fetchImage: vi.fn(async () => { throw new Error('404'); }) });
  const a = new ImageAnalyzer(deps);
  const cb = vi.fn();
  a.onResult(cb);
  await expect(a.request('https://x/missing.png')).resolves.toEqual({ verdict: 'other', animated: false });
  expect(debug).toHaveBeenCalledWith('[DarkExt] icon analysis failed', 'https://x/missing.png');
  expect(cb).toHaveBeenCalledTimes(1);
  await a.request('https://x/missing.png');
  expect(deps.fetchImage).toHaveBeenCalledTimes(1);
});

test('ошибка decode → other без отклонения', async () => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  const deps = fakeDeps({ decode: vi.fn(async () => { throw new Error('bad image'); }) });
  const a = new ImageAnalyzer(deps);
  await expect(a.request('https://x/dark.png')).resolves.toEqual({ verdict: 'other', animated: false });
});

test('maxConcurrent: 4 — не более 4 одновременных fetchImage, очередь продолжается', async () => {
  const pending: Deferred<{ dataUrl: string; animated: boolean }>[] = [];
  let active = 0, peak = 0;
  const deps = fakeDeps({
    fetchImage: vi.fn((_url: string) => {
      const d = deferred<{ dataUrl: string; animated: boolean }>();
      active++; peak = Math.max(peak, active);
      pending.push(d);
      return d.promise.finally(() => { active--; });
    }),
  });
  const a = new ImageAnalyzer(deps, { maxConcurrent: 4 });
  const all = Promise.all(Array.from({ length: 10 }, (_, i) => a.request(`https://x/${i}.png`)));
  await flush();
  expect(deps.fetchImage).toHaveBeenCalledTimes(4);
  let resolved = 0;
  while (resolved < 10) {
    await flush();
    const d = pending[resolved];
    if (!d) break;
    d.resolve({ dataUrl: 'data:image/png;base64,LIGHT', animated: false });
    resolved++;
  }
  const rs = await all;
  expect(rs).toHaveLength(10);
  expect(deps.fetchImage).toHaveBeenCalledTimes(10);
  expect(peak).toBe(4);
});

test('maxImages: 200 — 201-й URL не анализируется (other), без onResult', async () => {
  const deps = fakeDeps();
  const a = new ImageAnalyzer(deps, { maxImages: 200 });
  const cb = vi.fn();
  a.onResult(cb);
  await Promise.all(Array.from({ length: 200 }, (_, i) => a.request(`https://x/dark${i}.png`)));
  expect(deps.fetchImage).toHaveBeenCalledTimes(200);
  const r = await a.request('https://x/dark-extra.png');
  expect(r).toEqual({ verdict: 'other', animated: false });
  expect(deps.fetchImage).toHaveBeenCalledTimes(200);
  expect(cb).toHaveBeenCalledTimes(200);
  // already analysed URLs are still served
  expect((await a.request('https://x/dark0.png')).verdict).toBe('dark-icon');
});

test('по умолчанию maxImages = 200', async () => {
  const deps = fakeDeps();
  const a = new ImageAnalyzer(deps);
  await Promise.all(Array.from({ length: 201 }, (_, i) => a.request(`https://x/${i}.png`)));
  expect(deps.fetchImage).toHaveBeenCalledTimes(200);
});

test('анимированный GIF: вердикт вычисляется, inverted нет', async () => {
  const deps = fakeDeps();
  const a = new ImageAnalyzer(deps);
  const r = await a.request('https://x/dark-anim.gif');
  expect(r).toEqual({ verdict: 'dark-icon', animated: true });
  expect(deps.encode).not.toHaveBeenCalled();
});

test('dispose() до результата: колбэки не вызываются, результат не сохраняется', async () => {
  const d = deferred<{ dataUrl: string; animated: boolean }>();
  const deps = fakeDeps({ fetchImage: vi.fn(() => d.promise) });
  const a = new ImageAnalyzer(deps);
  const cb = vi.fn();
  a.onResult(cb);
  const p = a.request('https://x/dark.png');
  await flush();
  a.dispose();
  d.resolve({ dataUrl: 'data:image/png;base64,DARK', animated: false });
  await expect(p).resolves.toEqual({ verdict: 'other', animated: false });
  await flush();
  expect(cb).not.toHaveBeenCalled();
  expect(a.get('https://x/dark.png')).toBeUndefined();
  // new URLs after dispose resolve immediately to other
  await expect(a.request('https://x/dark2.png')).resolves.toEqual({ verdict: 'other', animated: false });
  expect(deps.fetchImage).toHaveBeenCalledTimes(1);
});

test('dispose() с очередью: ожидающие request разрешаются other без fetchImage', async () => {
  const d = deferred<{ dataUrl: string; animated: boolean }>();
  const deps = fakeDeps({ fetchImage: vi.fn(() => d.promise) });
  const a = new ImageAnalyzer(deps, { maxConcurrent: 1 });
  a.request('https://x/a.png');
  const queued = a.request('https://x/dark-b.png');
  await flush();
  a.dispose();
  await expect(queued).resolves.toEqual({ verdict: 'other', animated: false });
  expect(deps.fetchImage).toHaveBeenCalledTimes(1);
});

test('dispose(): кэшированные результаты больше не выдаются', async () => {
  const a = new ImageAnalyzer(fakeDeps());
  expect((await a.request('https://x/dark.png')).verdict).toBe('dark-icon');
  a.dispose();
  await expect(a.request('https://x/dark.png')).resolves.toEqual({ verdict: 'other', animated: false });
});

test('dispose(): ожидающие дубликаты in-flight получают other', async () => {
  const d = deferred<{ dataUrl: string; animated: boolean }>();
  const a = new ImageAnalyzer(fakeDeps({ fetchImage: vi.fn(() => d.promise) }));
  const p1 = a.request('https://x/dark.png');
  const p2 = a.request('https://x/dark.png');
  await flush();
  a.dispose();
  d.resolve({ dataUrl: 'data:image/png;base64,DARK', animated: false });
  await expect(p1).resolves.toEqual({ verdict: 'other', animated: false });
  await expect(p2).resolves.toEqual({ verdict: 'other', animated: false });
});

test('бросающий слушатель onResult не ломает request и других слушателей', async () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const a = new ImageAnalyzer(fakeDeps());
  a.onResult(() => { throw new Error('boom'); });
  const cb = vi.fn();
  a.onResult(cb);
  const rs = await Promise.all([a.request('https://x/dark.png'), a.request('https://x/dark.png')]);
  expect(rs.map((r) => r.verdict)).toEqual(['dark-icon', 'dark-icon']);
  expect(cb).toHaveBeenCalledTimes(1);
  expect(debug).toHaveBeenCalled();
});

test('onResult: отписка прекращает уведомления', async () => {
  const a = new ImageAnalyzer(fakeDeps());
  const cb = vi.fn();
  const off = a.onResult(cb);
  off();
  await a.request('https://x/dark.png');
  expect(cb).not.toHaveBeenCalled();
});

test('data: URL не вызывает fetchImage и декодируется напрямую', async () => {
  const deps = fakeDeps();
  const a = new ImageAnalyzer(deps);
  const url = 'data:image/png;base64,DARK';
  const r = await a.request(url);
  expect(deps.fetchImage).not.toHaveBeenCalled();
  expect(deps.decode).toHaveBeenCalledWith(url);
  expect(r.verdict).toBe('dark-icon');
  expect(r.animated).toBe(false);
  expect(r.inverted).toMatch(/^data:image\/png/);
});
