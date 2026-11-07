// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parseColor } from '../../core/color';
import { DEFAULT_GLOBAL } from '../../core/settings/defaults';
import { PRESETS } from '../../core/settings/presets';
import { resolveConfig, type EffectiveConfig } from '../../core/settings/resolve';
import { createPipeline as create, type Pipeline, type PipelineDeps } from './pipeline';
import { MaskIndex } from './masks';
import { parseCssText } from './sheets';

// Pass-through wrapper: counts how often the pipeline (re)counts variable usage of sheets.
const calls = vi.hoisted(() => ({ countVarUsage: 0, buildMirrorCss: 0 }));
// Pass-through wrapper: counts mirror builds (one per source build; recursion inside the module is not counted).
vi.mock('./mirror', async (importOriginal) => {
  const m = await importOriginal<typeof import('./mirror')>();
  return { ...m, buildMirrorCss: (...a: Parameters<typeof m.buildMirrorCss>) => { calls.buildMirrorCss++; return m.buildMirrorCss(...a); } };
});
vi.mock('./sheets', async (importOriginal) => {
  const m = await importOriginal<typeof import('./sheets')>();
  return {
    ...m,
    countVarUsage: (...a: Parameters<typeof m.countVarUsage>) => { calls.countVarUsage++; return m.countVarUsage(...a); },
  };
});

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
  const tokens = style(':root{--ink:#101114}');
  const usage = style('body{color:var(--ink)}');
  await frame();
  expect(varIn(tokens, '--ink').l).toBeGreaterThan(0.75);
  usage.remove();
  await frame();
  expect(varIn(tokens, '--ink').l).toBeLessThan(0.3); // bg again
});

test('C1: кросс-доменный лист с переменными, пришедший до листа-пользователя', async () => {
  const link = crossOriginLink('https://cdn.example/tokens.css');
  const p = createPipeline(document, { fetchCss: vi.fn(async () => ':root{--ink:#111111}') }); p.start(cfg());
  await settle();
  expect(varIn(link, '--ink').l).toBeLessThan(0.3);
  style('p{color:var(--ink)}');
  await frame();
  expect(varIn(link, '--ink').l).toBeGreaterThan(0.75);
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

test('M4: freeze останавливает наблюдение, не трогая страницу (зеркала, base и inline остаются)', async () => {
  const card = document.querySelector('.card')!;
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const darkened = card.getAttribute('style');
  p.freeze();
  const s = style('.x{background-color:#fff}');
  card.setAttribute('style', 'color:#000');
  p.refreshSheet((document.querySelector('style:not([data-darkext])') as HTMLStyleElement).sheet!);
  await frame();
  expect(mirrorOf(s)).toBeNull();
  expect(card.getAttribute('style')).toBe('color:#000'); // not re-styled: the observer is gone
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
  expect(document.querySelectorAll('[data-darkext=base]').length).toBe(1);
  expect(darkened).not.toBe('color:#000');
});

test('I6: <link>, ещё грузящийся к DOMContentLoaded, удерживает запасной стиль до своего зеркала', async () => {
  const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const link = document.createElement('link'); link.rel = 'stylesheet'; document.head.append(link); // sheet === null in jsdom
  readyState.mockReturnValue('interactive');
  document.dispatchEvent(new Event('readystatechange')); // before the observer's frame
  await frame(); // the observer sees the link: still loading
  expect(fallback()).not.toBeNull();
  Object.defineProperty(link, 'sheet', { value: { cssRules: parseCssText('.l{color:#000}'), ownerNode: link } });
  link.dispatchEvent(new Event('load'));
  expect(mirrorOf(link)).not.toBeNull();
  expect(fallback()).toBeNull();
});

// --- stage 1.5a: variable chains, per-role twins, masks, inline variables ---

test('1.5a: inline-цепочка --x-color:var(--secondary-icon) у svg → определение --secondary-icon светлое', async () => {
  const tokens = style(':root{--secondary-icon:#65686c}');
  style('.i{color:var(--x-color)}');
  document.body.insertAdjacentHTML('beforeend', '<svg class="i" style="--x-color:var(--secondary-icon)"></svg>');
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  await frame();
  expect(varIn(tokens, '--secondary-icon').l).toBeGreaterThan(0.6);
});

test('1.5a: inline-цепочка без подсказки по имени; элемент после старта и его удаление', async () => {
  const tokens = style(':root{--palette-gray:#65686c}');
  style('.i{color:var(--x-color)}');
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const dark = varIn(tokens, '--palette-gray').l;
  expect(dark).toBeLessThan(0.4); // no usages, no name hint → bg
  const wrap = document.createElement('div');
  wrap.innerHTML = '<svg class="i" style="--x-color:var(--palette-gray)"></svg>';
  document.body.append(wrap);
  await frame();
  expect(varIn(tokens, '--palette-gray').l).toBeGreaterThan(0.6); // text through the inline chain
  wrap.remove();
  await frame();
  await frame();
  expect(varIn(tokens, '--palette-gray').l).toBeCloseTo(dark, 5); // the element is gone: its links are dropped
});

test('1.5a: смешанная --white (7× фон, 6× color) → светлый двойник --white__dx-text, color переписаны', async () => {
  const tokens = style(':root{--white:#ffffff}');
  const bg = Array.from({ length: 7 }, (_, i) => `.b${i}{background-color:var(--white)}`).join('');
  const fg = Array.from({ length: 6 }, (_, i) => `.t${i}{color:var(--white)}`).join('');
  const uses = style(bg + fg);
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  await frame();
  expect(varIn(tokens, '--white__dx-text').l).toBeGreaterThan(0.6);
  expect(varIn(tokens, '--white').l).toBeLessThan(0.3); // main definition keeps the predominant role (bg)
  const text = mirrorOf(uses)!.textContent!;
  for (let i = 0; i < 6; i++) expect(text).toContain(`.t${i}{color:var(--white__dx-text, var(--white));}`);
});

const maskPage = () => {
  const tokens = style(':root{--c:#404244}');
  style('.cdx-button__icon{background-color:var(--c)}');
  const mask = style('.menu{-webkit-mask-image:url(a.svg)}');
  document.body.insertAdjacentHTML('beforeend', '<span class="cdx-button__icon menu"></span>');
  return { tokens, mask };
};

test('1.5a: иконка-маска .cdx-button__icon.menu → --c в роли text, фон иконки светлый после кадра', async () => {
  const { tokens } = maskPage();
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  await frame();
  expect(varIn(tokens, '--c').l).toBeGreaterThan(0.6);
});

test('1.5a: 20 одинаковых перестроек подряд не пересчитывают счётчики и не меняют зеркала', async () => {
  const { tokens } = maskPage();
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  await frame();
  await frame();
  const before = [...document.querySelectorAll('[data-darkext=mirror]')].map(m => m.textContent);
  calls.countVarUsage = 0;
  for (let i = 0; i < 20; i++) {
    document.body.insertAdjacentHTML('beforeend', '<span class="cdx-button__icon menu"></span>'); // same mask signature
    p.update(cfg()); // rebuilds every mirrored source
    await frame();
  }
  expect(calls.countVarUsage).toBe(0);
  expect([...document.querySelectorAll('[data-darkext=mirror]')].map(m => m.textContent)).toEqual(before);
  expect(varIn(tokens, '--c').l).toBeGreaterThan(0.6);
});

test('1.5a: detach не оставляет [data-darkext] и очищает индекс масок; повторный start работает', async () => {
  const { tokens, mask } = maskPage();
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  await frame();
  expect(varIn(tokens, '--c').l).toBeGreaterThan(0.6);
  p.detach();
  expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
  mask.remove(); // no mask rule any more: a stale index would still treat the icon rule as a mask
  p.start(cfg());
  await frame();
  expect(mirrorOf(tokens)).not.toBeNull();
  expect(varIn(tokens, '--c').l).toBeLessThan(0.4); // bg again (#404244 → L≈0.34): the index was cleared
});

test('1.5a: старт с иконкой-маской — первое построение уже учитывает маску, без пересчёта в следующем кадре', async () => {
  const { tokens } = maskPage();
  const p = createPipeline(document, { fetchCss: vi.fn() });
  calls.countVarUsage = 0;
  p.start(cfg());
  expect(calls.countVarUsage).toBe(4); // .card, tokens, icon rule, mask rule: each sheet counted once
  expect(varIn(tokens, '--c').l).toBeGreaterThan(0.6); // light right after start
  const before = mirrorOf(tokens)!.textContent;
  await frame();
  await frame();
  expect(calls.countVarUsage).toBe(4);
  expect(mirrorOf(tokens)!.textContent).toBe(before);
});

test('1.5a: добавленный элемент ищется в своём поддереве, а не во всём документе', async () => {
  const { tokens } = maskPage();
  document.querySelector('span.cdx-button__icon')!.remove(); // no mask element at start: --c stays bg
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  await frame();
  expect(varIn(tokens, '--c').l).toBeLessThan(0.4);
  const refresh = vi.spyOn(MaskIndex.prototype, 'refresh');
  const wrap = document.createElement('div');
  wrap.innerHTML = '<span class="cdx-button__icon menu"></span>';
  document.body.append(wrap);
  await frame();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh.mock.calls[0][0]).toEqual([wrap]);
  expect(varIn(tokens, '--c').l).toBeGreaterThan(0.6); // found in the subtree: recount + rebuild
});

test('1.5a: индекс масок заполнен (300 сигнатур) → поиск больше не запускается', async () => {
  style('.menu{-webkit-mask-image:url(a.svg)}');
  document.body.insertAdjacentHTML('beforeend', Array.from({ length: 300 }, (_, i) => `<i class="menu c${i}"></i>`).join(''));
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  await frame();
  const refresh = vi.spyOn(MaskIndex.prototype, 'refresh');
  document.body.insertAdjacentHTML('beforeend', '<i class="menu extra"></i>');
  style('.other{mask-image:url(b.svg)}'); // even a grown selector set does not trigger a lookup
  await frame();
  await frame();
  expect(refresh).not.toHaveBeenCalled();
});

test('1.5a: shadow root, подключённый позже, ищется по уже известным селекторам масок', async () => {
  const { tokens } = maskPage();
  document.querySelector('span.cdx-button__icon')!.remove(); // the icon lives only in the shadow root
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  await frame();
  expect(varIn(tokens, '--c').l).toBeLessThan(0.4);
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<span class="cdx-button__icon menu"></span>';
  await frame(); // the host's insertion is a plain added node: the shadow content is not searched by it
  p.addRoot(root);
  await frame();
  expect(varIn(tokens, '--c').l).toBeGreaterThan(0.6);
});

// --- 1.5b: dark CSS icons ---

type Icon = import('./images').IconResult;
/** Fake analyzer: results are delivered by `finish`; listeners keep firing even after dispose (worst case). */
function fakeAnalyzer(opts: { request?: (url: string) => Promise<Icon> } = {}) {
  const results = new Map<string, Icon>();
  const listeners = new Set<(url: string, r: Icon) => void>();
  const a = {
    request: vi.fn(opts.request ?? (() => new Promise<Icon>(() => {}))),
    get: (url: string) => results.get(url),
    onResult: (cb: (url: string, r: Icon) => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    dispose: vi.fn(),
    finish(url: string, r: Icon) { results.set(url, r); for (const cb of [...listeners]) cb(url, r); },
  };
  return a;
}
const DATA = 'data:image/png;base64,AAAA';
const darkIcon: Icon = { verdict: 'dark-icon', animated: false, inverted: DATA };
const abs = (u: string) => new URL(u, document.baseURI).href;
const imagesDeps = (...fakes: ReturnType<typeof fakeAnalyzer>[]) => {
  let i = 0;
  return { fetchCss: vi.fn(), iconDelayMs: 1, images: () => fakes[Math.min(i++, fakes.length - 1)] as never };
};
/** Past the (shortened) icon debounce: the batch is published. */
const iconFlush = () => new Promise(r => setTimeout(r, 10));
const VAR0 = 'var(--darkext-icon-0)';
const iconVars = () => document.querySelector('style[data-darkext=icon-vars]')?.textContent ?? '';

test('1.5b: list-style-image → request; зеркало только после dark-icon и пакетной публикации', async () => {
  const a = fakeAnalyzer();
  const s = style('li{list-style-image:url(a.gif)}');
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  expect(a.request).toHaveBeenCalledWith(abs('a.gif'));
  expect(s.nextElementSibling?.getAttribute('data-darkext')).not.toBe('mirror');
  a.finish(abs('a.gif'), darkIcon);
  expect(s.nextElementSibling?.getAttribute('data-darkext')).not.toBe('mirror'); // coalesced into the batch
  await iconFlush();
  expect(s.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror');
  expect(s.nextElementSibling!.textContent).toContain(`list-style-image:${VAR0}`);
  expect(iconVars()).toBe(`:root{--darkext-icon-0:url("${DATA}");}`);
});

test('1.5b: вердикт other → зеркала нет, перестройки нет', async () => {
  const a = fakeAnalyzer();
  const s = style('li{list-style-image:url(a.gif)}');
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  const before = calls.countVarUsage;
  a.finish(abs('a.gif'), { verdict: 'other', animated: false });
  await iconFlush();
  expect(s.nextElementSibling?.getAttribute('data-darkext')).not.toBe('mirror');
  expect(calls.countVarUsage).toBe(before);
});

test('1.5b: перестройка по результату не пересчитывает переменные', async () => {
  const a = fakeAnalyzer();
  const s = style('li{list-style-image:url(a.gif);background-color:#fff}');
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  expect(s.nextElementSibling!.textContent).not.toContain('data:');
  const before = calls.countVarUsage;
  a.finish(abs('a.gif'), darkIcon);
  await iconFlush();
  expect(s.nextElementSibling!.textContent).toContain(`list-style-image:${VAR0}`);
  expect(calls.countVarUsage).toBe(before);
});

test('1.5b: результат после detach() ничего не пишет; detach вызывает dispose', async () => {
  const a = fakeAnalyzer();
  style('li{list-style-image:url(a.gif)}');
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  p.detach();
  expect(a.dispose).toHaveBeenCalledTimes(1);
  a.finish(abs('a.gif'), darkIcon);
  await iconFlush();
  expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
});

test('1.5b: start() после detach() создаёт новый анализатор и снова запрашивает', async () => {
  const a = fakeAnalyzer(), b = fakeAnalyzer();
  const s = style('li{list-style-image:url(a.gif)}');
  const p = createPipeline(document, imagesDeps(a, b)); p.start(cfg());
  p.detach(); p.start(cfg());
  expect(b.request).toHaveBeenCalledWith(abs('a.gif'));
  b.finish(abs('a.gif'), darkIcon);
  await iconFlush();
  expect(s.nextElementSibling!.textContent).toContain(`list-style-image:${VAR0}`);
});

test('1.5b: 20 одинаковых URL в разных листах → один request', () => {
  const a = fakeAnalyzer();
  for (let i = 0; i < 20; i++) style(`.i${i}{background-image:url(a.gif)}`);
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  expect(a.request).toHaveBeenCalledTimes(1);
});

test('1.5b: update перестраивает с известными вердиктами без новых запросов', async () => {
  const a = fakeAnalyzer();
  const s = style('li{list-style-image:url(a.gif)}');
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  a.finish(abs('a.gif'), darkIcon);
  await iconFlush();
  p.update({ ...cfg(), colors: PRESETS.find(x => x.id === 'oled')!.colors });
  await settle();
  expect(s.nextElementSibling!.textContent).toContain(`list-style-image:${VAR0}`);
  expect(document.querySelectorAll('style[data-darkext=icon-vars]').length).toBe(1);
  expect(a.request).toHaveBeenCalledTimes(1);
});

test('1.5b: новый лист после старта — его URL запрашивается и подменяется', async () => {
  const a = fakeAnalyzer();
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  const s = style('.n{background-image:url(b.png)}');
  await frame();
  expect(a.request).toHaveBeenCalledWith(abs('b.png'));
  a.finish(abs('b.png'), darkIcon);
  await iconFlush();
  expect(s.nextElementSibling!.textContent).toContain(`background-image:${VAR0}`);
});

test('1.5b: ошибка анализатора не меняет статус конвейера', async () => {
  const onStatus = vi.fn();
  const rejecting = fakeAnalyzer({ request: async () => { throw new Error('nope'); } });
  style('li{list-style-image:url(a.gif)}');
  const p = createPipeline(document, imagesDeps(rejecting)); p.onStatus(onStatus); p.start(cfg());
  await settle();
  expect(p.status()).toBe('ok');
  p.detach(); // q's mirrors alone must show it built
  expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
  const throwing = fakeAnalyzer({ request: () => { throw new Error('sync'); } });
  const q = createPipeline(document, imagesDeps(throwing)); q.onStatus(onStatus); q.start(cfg());
  await settle();
  expect(q.status()).toBe('ok');
  expect(onStatus).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBeGreaterThan(0);
});

test('1.5b: кросс-доменный лист — относительные url() от адреса листа, @import из другой папки — от своего', async () => {
  const files: Record<string, string> = {
    'https://cdn.example/css/main.css': '@import url("../lib/icons.css");.x{background-image:url(s.png)}',
    'https://cdn.example/lib/icons.css': '.y{list-style-image:url(img/i.gif)}',
  };
  const a = fakeAnalyzer();
  const link = crossOriginLink('https://cdn.example/css/main.css');
  const p = createPipeline(document, { fetchCss: vi.fn(async (u: string) => files[u]), iconDelayMs: 1, images: () => a as never });
  p.start(cfg());
  await settle();
  const urls = a.request.mock.calls.map(c => c[0]);
  expect(urls).toContain('https://cdn.example/css/s.png');
  expect(urls).toContain('https://cdn.example/lib/img/i.gif');
  a.finish('https://cdn.example/css/s.png', darkIcon);
  a.finish('https://cdn.example/lib/img/i.gif', darkIcon);
  await iconFlush();
  const css = link.nextElementSibling!.textContent!;
  expect(css).toMatch(/background-image:var\(--darkext-icon-[01]\)/);
  expect(css).toMatch(/list-style-image:var\(--darkext-icon-[01]\)/);
});

test('1.5b: без images поведение прежнее (зеркала без подмены)', () => {
  const s = style('li{list-style-image:url(a.gif);background-color:#fff}');
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  expect(s.nextElementSibling!.textContent).not.toContain('list-style-image');
});

// --- 1.5b: dark icon <img> ---

/** jsdom has no layout: a rendered, loaded 24×24 <img>. */
function iconImg(src: string, parent: ParentNode = document.body): HTMLImageElement {
  const img = document.createElement('img');
  img.setAttribute('src', src);
  Object.defineProperty(img, 'complete', { configurable: true, get: () => true });
  img.getBoundingClientRect = () => ({ width: 24, height: 24 }) as DOMRect;
  parent.append(img);
  return img;
}
/** Analyzer whose requests resolve with the verdict given per URL (default: never). */
function verdicts(map: Record<string, Icon>) {
  return fakeAnalyzer({ request: (url) => (map[url] ? Promise.resolve(map[url]) : new Promise<Icon>(() => {})) });
}

test('1.5b: <img> при старте и в теневом корне получает data-darkext-icon; detach снимает', async () => {
  const img = iconImg('https://x.test/logo.png');
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const inShadow = iconImg('https://x.test/s.png', root);
  const a = verdicts({ 'https://x.test/logo.png': darkIcon, 'https://x.test/s.png': darkIcon });
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg()); p.addRoot(root);
  await settle();
  expect(img.getAttribute('data-darkext-icon')).toBe('1');
  expect(inShadow.getAttribute('data-darkext-icon')).toBe('1');
  p.detach();
  expect(img.hasAttribute('data-darkext-icon')).toBe(false);
  expect(inShadow.hasAttribute('data-darkext-icon')).toBe(false);
});

test('1.5b: добавленный <img> (и вложенный) анализируется; смена src снимает атрибут и анализирует заново', async () => {
  const a = verdicts({ 'https://x.test/a.png': darkIcon });
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  const wrap = document.createElement('div');
  const nested = iconImg('https://x.test/a.png', wrap);
  document.body.append(wrap);
  const img = iconImg('https://x.test/a.png');
  await frame(); await settle();
  expect(nested.getAttribute('data-darkext-icon')).toBe('1');
  expect(img.getAttribute('data-darkext-icon')).toBe('1');
  const before = a.request.mock.calls.length;
  img.setAttribute('src', 'https://x.test/b.png');
  await frame();
  expect(img.hasAttribute('data-darkext-icon')).toBe(false);
  expect(a.request).toHaveBeenLastCalledWith('https://x.test/b.png');
  expect(a.request.mock.calls.length).toBe(before + 1); // our own attribute is not fed back
});

test('1.5b: freeze оставляет атрибуты; без images <img> не трогаются', async () => {
  const img = iconImg('https://x.test/logo.png');
  const a = verdicts({ 'https://x.test/logo.png': darkIcon });
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  await settle();
  p.freeze();
  expect(img.getAttribute('data-darkext-icon')).toBe('1');
  img.removeAttribute('data-darkext-icon');
  const q = createPipeline(document, { fetchCss: vi.fn() }); q.start(cfg());
  document.body.append(iconImg('https://x.test/other.png'));
  await frame(); await settle();
  expect(document.querySelectorAll('[data-darkext-icon]').length).toBe(0);
});

test('1.5b: setDisabled отключает базовый лист с фильтром значков', () => {
  const p = createPipeline(document, imagesDeps(fakeAnalyzer())); p.start(cfg());
  const base = document.querySelector('style[data-darkext=base]')!;
  expect(base.textContent).toContain('img[data-darkext-icon]');
  p.setDisabled(true);
  expect(base.getAttribute('media')).toBe('not all');
});

test('1.5b: теневой корень получает правило значков; setDisabled выключает; detach убирает; без images — нет', () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<p>x</p>';
  const p = createPipeline(document, imagesDeps(fakeAnalyzer())); p.start(cfg()); p.addRoot(root);
  const el = root.querySelector('style[data-darkext=icons]')!;
  expect(el.textContent).toContain('img[data-darkext-icon]{filter:invert(1) hue-rotate(180deg)');
  p.update({ ...cfg(), adj: { ...cfg().adj, img: 20 } });
  expect(el.textContent).toContain('brightness(0.8)');
  p.setDisabled(true); expect(el.getAttribute('media')).toBe('not all');
  p.setDisabled(false);
  p.detach(); expect(root.querySelector('[data-darkext]')).toBeNull();
  const q = createPipeline(document, { fetchCss: vi.fn() }); q.start(cfg()); q.addRoot(root);
  expect(root.querySelector('[data-darkext]')).toBeNull();
});

test('I3: <img>, удалённая до load, забывается после кадра наблюдателя', async () => {
  const a = verdicts({});
  const img = iconImg('https://x.test/slow.png');
  let complete = false;
  Object.defineProperty(img, 'complete', { configurable: true, get: () => complete });
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  img.remove();
  await frame(); await frame();
  complete = true;
  img.dispatchEvent(new Event('load'));
  expect(a.request).not.toHaveBeenCalled();
});

// --- C1 / I1 / I4: icon variables, batched publishing, CSP ---

test('C1: спрайт в 50 правилах → в зеркалах нет data:, 50 ссылок var(); data: URL один раз в стиле переменных', async () => {
  const a = fakeAnalyzer();
  const s = style(Array.from({ length: 50 }, (_, i) => `.s${i}{background:url(sprite.png) -${i * 16}px 0 no-repeat}`).join(''));
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const inner = style('.t{background-image:url(sprite.png)}', root);
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg()); p.addRoot(root);
  const before = calls.countVarUsage;
  a.finish(abs('sprite.png'), darkIcon);
  await iconFlush(); await frame();
  const mirror = s.nextElementSibling!.textContent!;
  expect(mirror).not.toContain('data:');
  expect((mirror.match(/var\(--darkext-icon-0\)/g) ?? []).length).toBe(50);
  expect(inner.nextElementSibling!.textContent).toBe(`.t{background-image:${VAR0};}`); // inherited from the document root
  const vars = iconVars();
  expect(vars.split(DATA).length - 1).toBe(1);
  // Ours: not mirrored, not counted
  expect(document.querySelector('style[data-darkext=icon-vars] + style[data-darkext=mirror]')).toBeNull();
  expect(calls.countVarUsage).toBe(before);
  const el = document.querySelector('style[data-darkext=icon-vars]')!;
  p.setDisabled(true); expect(el.getAttribute('media')).toBe('not all');
  p.setDisabled(false);
  p.detach();
  expect(document.querySelector('style[data-darkext=icon-vars]')).toBeNull();
});

test('C1: freeze оставляет стиль переменных (зеркала продолжают на него ссылаться)', async () => {
  const a = fakeAnalyzer();
  style('li{list-style-image:url(a.gif)}');
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  a.finish(abs('a.gif'), darkIcon);
  await iconFlush();
  p.freeze();
  expect(iconVars()).toContain(DATA);
  p.detach();
});

test('I1: 10 результатов в окне debounce → одна перестройка на затронутый источник', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const a = fakeAnalyzer();
    const urls = Array.from({ length: 10 }, (_, i) => `i${i}.png`);
    style(urls.map((u, i) => `.a${i}{background-image:url(${u})}`).join(''));
    style(urls.map((u, i) => `.b${i}{list-style-image:url(${u})}`).join(''));
    style('.c{background-image:url(other.png)}'); // not affected
    const p = createPipeline(document, { fetchCss: vi.fn(), images: () => a as never }); p.start(cfg());
    const base = calls.buildMirrorCss;
    for (const u of urls) { a.finish(abs(u), darkIcon); vi.advanceTimersByTime(20); }
    vi.advanceTimersByTime(249 - 20);
    expect(calls.buildMirrorCss).toBe(base);
    vi.advanceTimersByTime(1);
    expect(calls.buildMirrorCss).toBe(base + 2);
    expect((iconVars().match(/--darkext-icon-\d+:/g) ?? []).length).toBe(10);
    // a later result rebuilds only the sources using it
    a.finish(abs('other.png'), darkIcon);
    vi.advanceTimersByTime(250);
    expect(calls.buildMirrorCss).toBe(base + 3);
    // a repeated result for a published URL changes nothing
    a.finish(abs('i0.png'), darkIcon);
    vi.advanceTimersByTime(2000);
    expect(calls.buildMirrorCss).toBe(base + 3);
  } finally {
    vi.useRealTimers();
  }
});

test('I1: непрерывный поток результатов публикуется не позже чем через 1 с после первого', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const a = fakeAnalyzer();
    const urls = Array.from({ length: 8 }, (_, i) => `s${i}.png`);
    const s = style(urls.map((u, i) => `.a${i}{background-image:url(${u})}`).join(''));
    const p = createPipeline(document, { fetchCss: vi.fn(), images: () => a as never }); p.start(cfg());
    for (const u of urls.slice(0, 5)) { a.finish(abs(u), darkIcon); vi.advanceTimersByTime(200); } // t = 1000
    expect(s.nextElementSibling!.textContent).toContain('var(--darkext-icon-');
  } finally {
    vi.useRealTimers();
  }
});

function cspViolation(blockedURI: string): Event {
  const e = new Event('securitypolicyviolation', { bubbles: true, composed: true });
  Object.defineProperty(e, 'blockedURI', { value: blockedURI });
  return e;
}

test('I4: нарушение CSP для data: → подмены в CSS выключены, зеркала возвращают оригинал; <img> не затронуты', async () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const img = iconImg('https://x.test/logo.png');
  const a = verdicts({ 'https://x.test/logo.png': darkIcon });
  const s = style('li{list-style-image:url(a.gif)}.x{background-image:url(b.png)}');
  const p = createPipeline(document, imagesDeps(a)); p.start(cfg());
  a.finish(abs('a.gif'), darkIcon);
  await iconFlush();
  expect(s.nextElementSibling!.textContent).toContain(VAR0);
  document.dispatchEvent(cspViolation('https://x.test/blocked.png')); // not data: — ignored
  expect(iconVars()).toContain(DATA);
  document.dispatchEvent(cspViolation('data'));
  expect(document.querySelector('style[data-darkext=icon-vars]')).toBeNull();
  expect(s.nextElementSibling?.textContent ?? '').not.toContain('var(--darkext-icon-');
  a.finish(abs('b.png'), darkIcon); // later results: no swap
  await iconFlush();
  expect(document.querySelector('style[data-darkext=icon-vars]')).toBeNull();
  expect(s.nextElementSibling?.textContent ?? '').not.toContain('var(--darkext-icon-');
  await settle();
  expect(img.getAttribute('data-darkext-icon')).toBe('1');
  expect(debug).toHaveBeenCalledWith('[DarkExt] data: images blocked by the page CSP: CSS icon swaps off');
});
