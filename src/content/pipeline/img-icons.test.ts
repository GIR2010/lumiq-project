// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import type { IconResult } from './images';
import { ImgIcons } from './img-icons';

const ATTR = 'data-darkext-icon';
const dark: IconResult = { verdict: 'dark-icon', animated: false };
const other: IconResult = { verdict: 'other', animated: false };

/** Analyzer whose results are delivered by `finish(url, r)`. */
function fakeAnalyzer() {
  const pending = new Map<string, Array<(r: IconResult) => void>>();
  return {
    request: vi.fn((url: string) => new Promise<IconResult>((res) => {
      pending.set(url, [...(pending.get(url) ?? []), res]);
    })),
    async finish(url: string, r: IconResult) {
      for (const res of pending.get(url) ?? []) res(r);
      pending.delete(url);
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

interface Opts { w?: number; h?: number; complete?: boolean; src?: string; currentSrc?: string }
/** jsdom has no layout or image loading: size, `complete` and `currentSrc` are stubbed (and mutable via the returned state). */
function makeImg(o: Opts = {}) {
  const img = document.createElement('img');
  const state = { w: o.w ?? 24, h: o.h ?? 24, complete: o.complete ?? true, currentSrc: o.currentSrc ?? '' };
  if (o.src !== undefined) img.setAttribute('src', o.src);
  Object.defineProperty(img, 'complete', { configurable: true, get: () => state.complete });
  Object.defineProperty(img, 'currentSrc', { configurable: true, get: () => state.currentSrc });
  img.getBoundingClientRect = () => ({ width: state.w, height: state.h, x: 0, y: 0, top: 0, left: 0, right: state.w, bottom: state.h, toJSON: () => ({}) }) as DOMRect;
  document.body.append(img);
  return { img, state };
}

beforeEach(() => { document.body.innerHTML = ''; });

test('<img> 24×24 с вердиктом dark-icon получает атрибут', async () => {
  const a = fakeAnalyzer();
  const { img } = makeImg({ src: 'https://x.test/logo.png' });
  new ImgIcons(a as never).consider(img);
  expect(a.request).toHaveBeenCalledWith('https://x.test/logo.png');
  expect(img.hasAttribute(ATTR)).toBe(false);
  await a.finish('https://x.test/logo.png', dark);
  expect(img.getAttribute(ATTR)).toBe('1');
});

test('вердикт other → атрибута нет', async () => {
  const a = fakeAnalyzer();
  const { img } = makeImg({ src: 'https://x.test/photo.png' });
  new ImgIcons(a as never).consider(img);
  await a.finish('https://x.test/photo.png', other);
  expect(img.hasAttribute(ATTR)).toBe(false);
});

test('большая картинка (500×500 на экране) не анализируется; 400×400 — анализируется', () => {
  const a = fakeAnalyzer();
  const icons = new ImgIcons(a as never);
  icons.consider(makeImg({ w: 500, h: 500, src: 'https://x.test/big.png' }).img);
  icons.consider(makeImg({ w: 24, h: 401, src: 'https://x.test/tall.png' }).img);
  expect(a.request).not.toHaveBeenCalled();
  icons.consider(makeImg({ w: 400, h: 400, src: 'https://x.test/edge.png' }).img);
  expect(a.request).toHaveBeenCalledWith('https://x.test/edge.png');
});

test('0×0 (не отрисована) пропускается; пустой src и blob: не анализируются; data: анализируется', () => {
  const a = fakeAnalyzer();
  const icons = new ImgIcons(a as never);
  icons.consider(makeImg({ w: 0, h: 0, src: 'https://x.test/hidden.png' }).img);
  icons.consider(makeImg({}).img);
  icons.consider(makeImg({ currentSrc: 'blob:https://x.test/abc' }).img);
  expect(a.request).not.toHaveBeenCalled();
  icons.consider(makeImg({ src: 'data:image/png;base64,AAAA' }).img);
  expect(a.request).toHaveBeenCalledWith('data:image/png;base64,AAAA');
});

test('незагруженная картинка ждёт load, потом анализируется', () => {
  const a = fakeAnalyzer();
  const { img, state } = makeImg({ complete: false, src: 'https://x.test/a.png' });
  new ImgIcons(a as never).consider(img);
  expect(a.request).not.toHaveBeenCalled();
  state.complete = true;
  img.dispatchEvent(new Event('load'));
  expect(a.request).toHaveBeenCalledTimes(1);
  img.dispatchEvent(new Event('load'));
  expect(a.request).toHaveBeenCalledTimes(1); // the listener is gone
});

test('srcset: анализ по currentSrc', () => {
  const a = fakeAnalyzer();
  const { img } = makeImg({ src: 'https://x.test/1x.png', currentSrc: 'https://x.test/2x.png' });
  img.setAttribute('srcset', 'https://x.test/1x.png 1x, https://x.test/2x.png 2x');
  new ImgIcons(a as never).consider(img);
  expect(a.request).toHaveBeenCalledWith('https://x.test/2x.png');
});

test('смена src снимает атрибут до нового вердикта и анализирует новый currentSrc', async () => {
  const a = fakeAnalyzer();
  const { img, state } = makeImg({ src: 'https://x.test/a.png', currentSrc: 'https://x.test/a.png' });
  const icons = new ImgIcons(a as never);
  icons.consider(img);
  await a.finish('https://x.test/a.png', dark);
  expect(img.getAttribute(ATTR)).toBe('1');
  img.setAttribute('src', 'https://x.test/b.png');
  state.currentSrc = 'https://x.test/b.png';
  icons.consider(img);
  expect(img.hasAttribute(ATTR)).toBe(false);
  expect(a.request).toHaveBeenLastCalledWith('https://x.test/b.png');
  await a.finish('https://x.test/b.png', dark);
  expect(img.getAttribute(ATTR)).toBe('1');
});

test('смена src во время загрузки (complete=false): атрибут снят сразу, анализ после load', async () => {
  const a = fakeAnalyzer();
  const { img, state } = makeImg({ src: 'https://x.test/a.png' });
  const icons = new ImgIcons(a as never);
  icons.consider(img);
  await a.finish('https://x.test/a.png', dark);
  img.setAttribute('src', 'https://x.test/b.png');
  state.complete = false;
  icons.consider(img);
  expect(img.hasAttribute(ATTR)).toBe(false);
  expect(a.request).toHaveBeenCalledTimes(1);
  state.complete = true;
  img.dispatchEvent(new Event('load'));
  expect(a.request).toHaveBeenLastCalledWith('https://x.test/b.png');
});

test('поздний вердикт для старого src не применяется', async () => {
  const a = fakeAnalyzer();
  const { img } = makeImg({ src: 'https://x.test/a.png' });
  const icons = new ImgIcons(a as never);
  icons.consider(img);
  img.setAttribute('src', 'https://x.test/b.png'); // changed while analysing, not considered yet
  await a.finish('https://x.test/a.png', dark);
  expect(img.hasAttribute(ATTR)).toBe(false);
});

test('scan находит все <img> корня, включая теневой', () => {
  const a = fakeAnalyzer();
  makeImg({ src: 'https://x.test/1.png' }); makeImg({ src: 'https://x.test/2.png' });
  const icons = new ImgIcons(a as never);
  icons.scan(document);
  expect(a.request).toHaveBeenCalledTimes(2);
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const { img } = makeImg({ src: 'https://x.test/3.png' });
  root.append(img);
  icons.scan(root);
  expect(a.request).toHaveBeenLastCalledWith('https://x.test/3.png');
});

test('clear() снимает все атрибуты (и в теневых корнях), отписывается и игнорирует поздние вердикты', async () => {
  const a = fakeAnalyzer();
  const { img: one } = makeImg({ src: 'https://x.test/1.png' });
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const { img: two } = makeImg({ src: 'https://x.test/2.png' }); root.append(two);
  const { img: late } = makeImg({ src: 'https://x.test/3.png' });
  const { img: waiting, state } = makeImg({ complete: false, src: 'https://x.test/4.png' });
  const icons = new ImgIcons(a as never);
  icons.scan(document); icons.scan(root);
  await a.finish('https://x.test/1.png', dark);
  await a.finish('https://x.test/2.png', dark);
  expect(one.getAttribute(ATTR)).toBe('1'); expect(two.getAttribute(ATTR)).toBe('1');
  icons.clear();
  expect(one.hasAttribute(ATTR)).toBe(false); expect(two.hasAttribute(ATTR)).toBe(false);
  await a.finish('https://x.test/3.png', dark);
  expect(late.hasAttribute(ATTR)).toBe(false);
  state.complete = true;
  waiting.dispatchEvent(new Event('load'));
  icons.consider(one);
  expect(a.request).toHaveBeenCalledTimes(3);
});

test('stop() отписывается, но атрибуты оставляет (freeze)', async () => {
  const a = fakeAnalyzer();
  const { img } = makeImg({ src: 'https://x.test/1.png' });
  const { img: late } = makeImg({ src: 'https://x.test/2.png' });
  const icons = new ImgIcons(a as never);
  icons.scan(document);
  await a.finish('https://x.test/1.png', dark);
  icons.stop();
  await a.finish('https://x.test/2.png', dark);
  expect(img.getAttribute(ATTR)).toBe('1');
  expect(late.hasAttribute(ATTR)).toBe(false);
});

test('анимированный GIF-<img> с dark-icon получает фильтр-атрибут (src не меняется)', async () => {
  const a = fakeAnalyzer();
  const { img } = makeImg({ src: 'https://x.test/spinner.gif' });
  new ImgIcons(a as never).consider(img);
  await a.finish('https://x.test/spinner.gif', { verdict: 'dark-icon', animated: true });
  expect(img.getAttribute(ATTR)).toBe('1');
  expect(img.getAttribute('src')).toBe('https://x.test/spinner.gif');
});

test('ошибка анализатора — картинка как есть, без исключений', async () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const { img } = makeImg({ src: 'https://x.test/1.png' });
  new ImgIcons({ request: () => { throw new Error('sync'); } } as never).consider(img);
  new ImgIcons({ request: async () => { throw new Error('async'); } } as never).consider(img);
  await new Promise((r) => setTimeout(r, 0));
  expect(img.hasAttribute(ATTR)).toBe(false);
  expect(debug).toHaveBeenCalledWith('[DarkExt] icon analysis failed', 'https://x.test/1.png');
  debug.mockRestore();
});
