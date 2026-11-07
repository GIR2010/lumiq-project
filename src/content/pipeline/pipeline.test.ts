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
  await frame(); // refreshes are coalesced per frame
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

test('бюджет окна загрузки: листы после старта сверх 3000 мс → heavy, новый лист не зеркалируется, update перестраивает применённые', async () => {
  // The budget covers the load window only: the document is still loading here.
  const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
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
  // Load finished: the window closes and sheets added later are processed normally (status stays heavy).
  readyState.mockReturnValue('complete');
  document.dispatchEvent(new Event('readystatechange'));
  step = 2000;
  const d = add('d');
  await frame();
  expect(d.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror');
  expect(p.status()).toBe('heavy');
});

test('I2: после окна загрузки update() и новые листы не тратят бюджет: статус не heavy, поздний лист зеркалируется', async () => {
  let t = 0, step = 0;
  const p = createPipeline(document, { fetchCss: vi.fn(), now: () => (t += step) });
  const seen: string[] = []; p.onStatus(s => seen.push(s));
  p.start(cfg()); // jsdom: the document is complete, so the window closes after the first pass
  step = 1000; // every measured stretch now "takes" 1000 ms
  const oled = { ...cfg(), colors: PRESETS.find(x => x.id === 'oled')!.colors };
  for (let i = 0; i < 6; i++) { p.update(i % 2 ? cfg() : oled); await settle(); }
  const late = style('.late{background-color:#fff}');
  await frame();
  expect(mirrorOf(late)).not.toBeNull();
  expect(p.status()).toBe('ok');
  expect(seen).toEqual([]);
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

// --- final review fixes ---

const mirrorOf = (el: Element) => el.nextElementSibling?.getAttribute('data-darkext') === 'mirror' ? el.nextElementSibling! : null;
const varIn = (el: Element, name: string) => parseColor(new RegExp(`${name}:([^;]+);`).exec(mirrorOf(el)?.textContent ?? '')![1])!;
const style = (css: string, parent: Element | ShadowRoot = document.head) => {
  const s = document.createElement('style'); s.textContent = css; parent.append(s); return s;
};

test('C1: переменные из листа, загруженного раньше листа-пользователя, получают роль по использованию', async () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const tokens = style(':root{--fg:#101114;--bg:#ffffff}');
  style('body{color:var(--fg);background-color:var(--bg)}');
  await frame();
  expect(varIn(tokens, '--fg').l).toBeGreaterThan(0.75); // text: light
  expect(varIn(tokens, '--bg').l).toBeLessThan(0.3);
});

test('C1: удаление листа-пользователя возвращает роль по умолчанию и перестраивает лист с определением', async () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const tokens = style(':root{--fg:#101114}');
  const usage = style('body{color:var(--fg)}');
  await frame();
  expect(varIn(tokens, '--fg').l).toBeGreaterThan(0.75);
  usage.remove();
  await frame();
  expect(varIn(tokens, '--fg').l).toBeLessThan(0.3); // bg again
});

test('C1: кросс-доменный лист с переменными, пришедший до листа-пользователя', async () => {
  const link = crossOriginLink('https://cdn.example/tokens.css');
  const p = createPipeline(document, { fetchCss: vi.fn(async () => ':root{--fg:#111111}') }); p.start(cfg());
  await settle();
  expect(varIn(link, '--fg').l).toBeLessThan(0.3);
  style('p{color:var(--fg)}');
  await frame();
  expect(varIn(link, '--fg').l).toBeGreaterThan(0.75);
});

test('I5: 50 вызовов refreshSheet одного листа в пределах кадра → одна перестройка', async () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const s = document.querySelector('style:not([data-darkext])') as HTMLStyleElement;
  const mirror = mirrorOf(s)!;
  let rewrites = 0;
  const mo = new MutationObserver((recs) => { rewrites += recs.length; });
  mo.observe(mirror, { childList: true, characterData: true, subtree: true });
  s.sheet!.insertRule('.added{background-color:#fff}', s.sheet!.cssRules.length);
  for (let i = 0; i < 50; i++) p.refreshSheet(s.sheet!);
  await frame();
  mo.disconnect();
  expect(mirror.textContent).toContain('.added{');
  expect(rewrites).toBe(1);
});

test('I5: повторный refreshSheet неизменного листа не меняет счёт ролей переменных', async () => {
  const p = createPipeline(document, { fetchCss: vi.fn() });
  const tokens = style(':root{--x:#ffffff}');
  const usesAsText = style('p{color:var(--x)}');
  style('div{background-color:var(--x)}span{background-color:var(--x)}'); // bg 2 : text 1
  p.start(cfg());
  expect(varIn(tokens, '--x').l).toBeLessThan(0.3);
  for (let i = 0; i < 3; i++) { p.refreshSheet(usesAsText.sheet!); await frame(); }
  expect(varIn(tokens, '--x').l).toBeLessThan(0.3); // still bg: counts were replaced, not added
});

const fallback = () => document.querySelector('[data-darkext=fallback]');

test('I6: запасной стиль html/body держится, пока грузится кросс-доменный лист; снимается после зеркала', async () => {
  let release!: (css: string) => void;
  const link = crossOriginLink('https://cdn.example/site.css');
  const p = createPipeline(document, { fetchCss: vi.fn(() => new Promise<string>(r => { release = r; })) });
  p.start(cfg());
  await settle();
  const fb = fallback()!;
  expect(fb).not.toBeNull();
  expect(fb.textContent).toMatch(/html,\s*body\s*\{[^}]*background-color:[^;}]+!important/);
  expect(bgOf('body').l).toBeLessThan(0.3);
  release('body{background-color:#fff}');
  await settle();
  expect(mirrorOf(link)).not.toBeNull();
  expect(fallback()).toBeNull();
});

test('I6: запасной стиль снимается через 2000 мс, если лист так и не пришёл; setDisabled его выключает; detach убирает', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    crossOriginLink('https://cdn.example/never.css');
    const p = createPipeline(document, { fetchCss: vi.fn(() => new Promise<string>(() => {})) });
    p.start(cfg());
    await vi.advanceTimersByTimeAsync(10);
    expect(fallback()).not.toBeNull();
    p.setDisabled(true);
    expect(fallback()!.getAttribute('media')).toBe('not all');
    p.setDisabled(false);
    expect(fallback()!.hasAttribute('media')).toBe(false);
    await vi.advanceTimersByTimeAsync(1980);
    expect(fallback()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(20);
    expect(fallback()).toBeNull();
    p.detach(); p.start(cfg());
    expect(fallback()).not.toBeNull();
    p.detach();
    expect(fallback()).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test('I6: при загрузке документа ждём листы, известные к DOMContentLoaded; без них запасной стиль снимается сразу', async () => {
  const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  expect(fallback()).not.toBeNull(); // still loading: sheets may yet arrive
  readyState.mockReturnValue('interactive');
  document.dispatchEvent(new Event('readystatechange'));
  expect(fallback()).toBeNull(); // every sheet present at DOMContentLoaded is mirrored
});

test('I3: лист, общий для двух shadow root, зеркалируется в оба; обновляется и снимается в обоих', async () => {
  const shared = new CSSStyleSheet(); shared.replaceSync('.inner{background-color:#fff}');
  const mk = () => {
    const h = document.createElement('div'); document.body.append(h);
    const r = h.attachShadow({ mode: 'open' }); r.adoptedStyleSheets = [shared]; return r;
  };
  const [r1, r2, r3] = [mk(), mk(), mk()];
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  [r1, r2, r3].forEach((r) => p.addRoot(r));
  const text = (r: ShadowRoot) => Array.from(r.adoptedStyleSheets[1]?.cssRules ?? []).map(x => x.cssText).join('');
  for (const r of [r1, r2, r3]) { expect(r.adoptedStyleSheets.length).toBe(2); expect(text(r)).toContain('.inner'); }
  shared.replaceSync('.inner2{background-color:#fff}');
  p.refreshSheet(shared); await frame();
  for (const r of [r1, r2, r3]) expect(text(r)).toContain('.inner2');
  r1.adoptedStyleSheets = []; // the page drops the sheet from one root
  p.adoptedChanged(r1); await frame();
  expect(r1.adoptedStyleSheets).toEqual([]);
  expect(r2.adoptedStyleSheets.length).toBe(2);
  r3.host.remove(); // a disconnected host is pruned during the next frame flush
  p.refreshSheet(shared); await frame();
  expect(r3.adoptedStyleSheets).toEqual([shared]);
  p.detach();
  expect(r2.adoptedStyleSheets).toEqual([shared]);
});
