// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parseColor } from '../../core/color';
import { DEFAULT_GLOBAL } from '../../core/settings/defaults';
import { PRESETS } from '../../core/settings/presets';
import { resolveConfig, type EffectiveConfig } from '../../core/settings/resolve';
import { createPipeline as create, type Pipeline, type PipelineDeps } from './pipeline';
import { parseCssText } from './sheets';

// Every pipeline a test creates is detached afterwards, so no observer leaks into the next test.
const live: Pipeline[] = [];
const createPipeline = (doc: Document, deps: PipelineDeps): Pipeline => {
  const p = create(doc, deps);
  live.push(p);
  return p;
};
afterEach(() => {
  for (const p of live.splice(0)) p.detach();
  vi.restoreAllMocks();
});

const cfg = (): EffectiveConfig => resolveConfig('a.com', DEFAULT_GLOBAL, undefined, []);
const bgOf = (sel: string) => parseColor(getComputedStyle(document.querySelector(sel)!).backgroundColor)!;
beforeEach(() => { document.head.innerHTML = '<style>.card{background-color:#ffffff}</style>'; document.body.innerHTML = '<div class="card" style="color:#000"></div>'; });

test('start делает фон тёмным, detach возвращает', () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
  expect(bgOf('.card').l).toBeLessThan(0.3);
  p.detach(); expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
});
test('start → detach → start → detach: один набор стилей, inline побайтно восстановлен', () => {
  const p = createPipeline(document, { fetchCss: vi.fn() });
  p.start(cfg()); p.detach(); p.start(cfg());
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
  expect(document.querySelectorAll('[data-darkext=base]').length).toBe(1);
  p.detach(); expect(document.querySelector('.card')!.getAttribute('style')).toBe('color:#000');
});
test('update меняет цвета без дублей', () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const before = document.querySelector('[data-darkext=mirror]')!.textContent;
  p.update({ ...cfg(), colors: PRESETS.find(x => x.id === 'oled')!.colors });
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
  expect(document.querySelector('[data-darkext=mirror]')!.textContent).not.toBe(before);
});
test('исключение внутри → detach и статус error', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const p = createPipeline(document, { fetchCss: vi.fn() });
  vi.spyOn(document, 'styleSheets', 'get').mockImplementation(() => { throw new Error('boom'); });
  p.start(cfg()); expect(p.status()).toBe('error'); expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
  expect(err).toHaveBeenCalledWith('[DarkExt]', expect.objectContaining({ message: 'boom' }));
});
test('новый <style> после старта обрабатывается наблюдателем', async () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const s = document.createElement('style'); s.textContent = '.x{background-color:#fff}'; document.head.append(s);
  await new Promise(r => requestAnimationFrame(() => r(null)));
  expect(s.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror');
});
test('pending-лист обрабатывается по load', () => {
  const p = createPipeline(document, { fetchCss: vi.fn() });
  const link = document.createElement('link'); link.rel = 'stylesheet'; document.head.append(link); // sheet === null в jsdom
  p.start(cfg());
  Object.defineProperty(link, 'sheet', { value: { cssRules: parseCssText('.l{color:#000}'), ownerNode: link } });
  link.dispatchEvent(new Event('load'));
  expect(link.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror');
});

// --- beyond the brief: cross-origin, statuses, shadow roots, observer edge cases ---

const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));
const settle = () => new Promise(r => setTimeout(r, 0));

/** A <link> whose sheet behaves like a cross-origin one (cssRules throws SecurityError). */
function crossOriginLink(href: string): HTMLLinkElement {
  const link = document.createElement('link'); link.rel = 'stylesheet';
  document.head.append(link);
  Object.defineProperty(link, 'sheet', {
    value: { href, ownerNode: link, get cssRules(): CSSRuleList { throw new DOMException('blocked', 'SecurityError'); } },
  });
  return link;
}

test('кросс-доменный лист: fetchCss (+ @import), зеркало после <link>, update не перезагружает', async () => {
  const files: Record<string, string> = {
    'https://cdn.example/a.css': '@import url("b.css");.co{background-color:#fff}',
    'https://cdn.example/b.css': '.imp{color:#000}',
  };
  const fetchCss = vi.fn(async (url: string) => files[url]);
  const link = crossOriginLink('https://cdn.example/a.css');
  const p = createPipeline(document, { fetchCss }); p.start(cfg());
  await settle();
  const mirror = link.nextElementSibling!;
  expect(mirror.getAttribute('data-darkext')).toBe('mirror');
  expect(mirror.textContent).toContain('.co{');
  expect(mirror.textContent).toContain('.imp{');
  expect(fetchCss.mock.calls.map(c => c[0])).toEqual(['https://cdn.example/a.css', 'https://cdn.example/b.css']);
  const before = mirror.textContent;
  p.update({ ...cfg(), colors: PRESETS.find(x => x.id === 'oled')!.colors });
  await settle();
  expect(link.nextElementSibling!.textContent).not.toBe(before);
  expect(fetchCss).toHaveBeenCalledTimes(2);
  p.detach(); p.start(cfg()); await settle();
  expect(link.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror');
  expect(fetchCss).toHaveBeenCalledTimes(2);
});

test('ошибка fetchCss → лист пропущен, статус не меняется', async () => {
  const link = crossOriginLink('https://cdn.example/broken.css');
  const onStatus = vi.fn();
  const p = createPipeline(document, { fetchCss: vi.fn(async () => { throw new Error('network'); }) });
  p.onStatus(onStatus); p.start(cfg());
  await settle();
  expect(link.nextElementSibling?.getAttribute('data-darkext')).not.toBe('mirror');
  expect(p.status()).toBe('ok');
  expect(onStatus).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1); // the <head> <style> still mirrored
});

test('onStatus вызывается при смене статуса; start после error снова ok', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const p = createPipeline(document, { fetchCss: vi.fn() });
  const seen: string[] = []; p.onStatus(s => seen.push(s));
  const spy = vi.spyOn(document, 'styleSheets', 'get').mockImplementation(() => { throw new Error('boom'); });
  p.start(cfg());
  spy.mockRestore();
  p.start(cfg());
  expect(seen).toEqual(['error', 'ok']);
  expect(p.status()).toBe('ok');
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
});

test('setDisabled: зеркала выключены и inline восстановлен; включение возвращает', () => {
  const card = document.querySelector('.card')!;
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const darkened = card.getAttribute('style');
  expect(darkened).not.toBe('color:#000');
  p.setDisabled(true);
  expect(document.querySelector('[data-darkext=mirror]')!.getAttribute('media')).toBe('not all');
  expect(card.getAttribute('style')).toBe('color:#000');
  p.setDisabled(false);
  expect(document.querySelector('[data-darkext=mirror]')!.hasAttribute('media')).toBe(false);
  expect(card.getAttribute('style')).toBe(darkened);
});

test('наблюдатель: добавленный элемент со style, удалённый <style>, base снова первым', async () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const wrap = document.createElement('section');
  wrap.innerHTML = '<p style="background-color:#fff">x</p>';
  document.body.append(wrap);
  const intruder = document.createElement('style'); intruder.textContent = '.y{color:#000}';
  document.head.prepend(intruder);
  await frame();
  expect(wrap.querySelector('p')!.getAttribute('style')).not.toBe('background-color:#fff');
  expect(document.head.firstElementChild!.getAttribute('data-darkext')).toBe('base');
  expect(intruder.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror');
  intruder.remove();
  await frame();
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
  p.detach();
  expect(wrap.querySelector('p')!.getAttribute('style')).toBe('background-color:#fff');
});

test('изменение текста <style> перестраивает зеркало', async () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const s = document.querySelector('style:not([data-darkext])')!;
  s.textContent = '.card{background-color:#ffffff}.z{color:#000}';
  await frame();
  expect(s.nextElementSibling!.textContent).toContain('.z{');
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
});

test('addRoot: <style> и adoptedStyleSheets shadow root, refreshSheet, detach убирает зеркала', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>.in{background-color:#fff}</style><span style="color:#000">s</span>';
  const adopted = new CSSStyleSheet(); adopted.replaceSync('.ad{background-color:#fff}');
  root.adoptedStyleSheets = [adopted];
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  p.addRoot(root);
  expect(root.querySelector('style')!.nextElementSibling!.getAttribute('data-darkext')).toBe('mirror');
  expect(root.adoptedStyleSheets.length).toBe(2);
  expect(root.querySelector('span')!.getAttribute('style')).not.toBe('color:#000');
  const mirrorText = () => Array.from(root.adoptedStyleSheets[1].cssRules).map(r => r.cssText).join('');
  expect(mirrorText()).toContain('.ad');
  adopted.replaceSync('.ad2{color:#000}');
  p.refreshSheet(adopted);
  expect(root.adoptedStyleSheets.length).toBe(2);
  expect(mirrorText()).toContain('.ad2');
  p.refreshSheet(root.adoptedStyleSheets[1]); // our own mirror is ignored
  expect(root.adoptedStyleSheets.length).toBe(2);
  const late = document.createElement('style'); late.textContent = '.late{color:#000}'; root.append(late);
  await frame();
  expect(late.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror');
  p.detach();
  expect(root.adoptedStyleSheets).toEqual([adopted]);
  expect(root.querySelectorAll('[data-darkext]').length).toBe(0);
  expect(root.querySelector('span')!.getAttribute('style')).toBe('color:#000');
  p.start(cfg()); // known roots are re-processed on the next start
  expect(root.adoptedStyleSheets.length).toBe(2);
});

test('update перекрашивает inline-стили от оригинала; detach восстанавливает оригинал', () => {
  const card = document.querySelector('.card')!;
  document.body.insertAdjacentHTML('beforeend', '<p style="background-color:#fff">x</p>');
  const para = document.querySelector('p')!;
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const before = para.getAttribute('style');
  p.update({ ...cfg(), colors: PRESETS.find(x => x.id === 'oled')!.colors });
  expect(para.getAttribute('style')).not.toBe(before);
  expect(para.getAttribute('style')).not.toBe('background-color:#fff');
  p.detach();
  expect(para.getAttribute('style')).toBe('background-color:#fff');
  expect(card.getAttribute('style')).toBe('color:#000');
});

test('бюджет первого прохода: время сбора и подсчёта переменных засчитывается', async () => {
  let calls = 0;
  const now = () => (calls++ === 0 ? 0 : 400); // resolving + counting "took" 400 ms > 300 ms first pass
  const p = createPipeline(document, { fetchCss: vi.fn(), now }); p.start(cfg());
  const style = document.querySelector('style:not([data-darkext])')!;
  expect(style.nextElementSibling?.getAttribute('data-darkext')).not.toBe('mirror'); // pushed out of the sync pass
  await vi.waitFor(() => expect(style.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror'));
  expect(p.status()).toBe('ok');
});

test('бюджет сессии: листы после старта сверх 3000 мс → heavy, новый лист не зеркалируется, update перестраивает применённые', async () => {
  let t = 0, step = 0;
  const p = createPipeline(document, { fetchCss: vi.fn(), now: () => (t += step) });
  const seen: string[] = []; p.onStatus(s => seen.push(s));
  p.start(cfg());
  const add = (cls: string) => {
    const s = document.createElement('style'); s.textContent = `.${cls}{background-color:#fff}`; document.head.append(s); return s;
  };
  step = 2000; // every build now measures 2000 ms
  const a = add('a'), b = add('b');
  await frame();
  expect(a.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror'); // 2000 ms spent
  expect(b.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror'); // 4000 ms spent → heavy
  expect(p.status()).toBe('heavy');
  expect(seen).toEqual(['heavy']);
  const c = add('c');
  await frame();
  expect(c.nextElementSibling?.getAttribute('data-darkext')).not.toBe('mirror');
  step = 0;
  const before = a.nextElementSibling!.textContent;
  p.update({ ...cfg(), colors: PRESETS.find(x => x.id === 'oled')!.colors });
  expect(a.nextElementSibling!.textContent).not.toBe(before);
  expect(c.nextElementSibling?.getAttribute('data-darkext')).not.toBe('mirror');
  expect(p.status()).toBe('heavy');
});

test('fetchCss завершился после detach → ничего не пишется; следующий start работает без повторной загрузки', async () => {
  let release!: (css: string) => void;
  const fetchCss = vi.fn(() => new Promise<string>(r => { release = r; }));
  const link = crossOriginLink('https://cdn.example/late.css');
  const p = createPipeline(document, { fetchCss }); p.start(cfg());
  await settle(); // fetch in flight
  p.detach();
  release('.late{background-color:#fff}');
  await settle();
  expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
  p.start(cfg()); await settle();
  expect(link.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror');
  expect(fetchCss).toHaveBeenCalledTimes(1);
});

test('удалённый <link> → его зеркало удаляется', async () => {
  const link = document.createElement('link'); link.rel = 'stylesheet'; document.head.append(link);
  Object.defineProperty(link, 'sheet', { value: { cssRules: parseCssText('.l{color:#000}'), ownerNode: link } });
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const mirror = link.nextElementSibling!;
  expect(mirror.getAttribute('data-darkext')).toBe('mirror');
  link.remove();
  await frame();
  expect(mirror.isConnected).toBe(false);
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
});

test('исключение в обработчике load → статус error, наших узлов нет', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const link = document.createElement('link'); link.rel = 'stylesheet'; document.head.append(link);
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  Object.defineProperty(link, 'sheet', { get() { throw new Error('load boom'); } });
  link.dispatchEvent(new Event('load'));
  expect(p.status()).toBe('error');
  expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
  expect(err).toHaveBeenCalledWith('[DarkExt]', expect.objectContaining({ message: 'load boom' }));
});

test('detach идемпотентен', () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  p.detach(); p.detach();
  expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
});
