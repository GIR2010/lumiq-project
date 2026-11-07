// @vitest-environment jsdom
import { beforeAll, expect, test, vi } from 'vitest';

beforeAll(async () => {
  await import('./hook');
  vi.resetModules();
  await import('./hook'); // second injection must not double-wrap
});

const tick = () => Promise.resolve();

test('attachShadow open -> darkext:shadow on host; closed -> no event', () => {
  const cb = vi.fn();
  document.addEventListener('darkext:shadow', cb);
  const a = document.createElement('div');
  document.body.append(a);
  const root = a.attachShadow({ mode: 'open' });
  const b = document.createElement('div');
  document.body.append(b);
  b.attachShadow({ mode: 'closed' });
  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb.mock.calls[0][0].target).toBe(a);
  expect(a.shadowRoot).toBe(root);
  document.removeEventListener('darkext:shadow', cb);
});

test('attachShadow still throws the original error', () => {
  const div = document.createElement('div');
  div.attachShadow({ mode: 'open' });
  expect(() => div.attachShadow({ mode: 'open' })).toThrow(DOMException);
});

test('insertRule -> one darkext:sheet-changed on ownerNode, rule inserted', async () => {
  const s = document.createElement('style');
  document.head.append(s);
  const cb = vi.fn();
  s.addEventListener('darkext:sheet-changed', cb);
  const idx = s.sheet!.insertRule('.z{color:red}', 0);
  expect(idx).toBe(0);
  expect(s.sheet!.cssRules.length).toBe(1);
  expect(cb).not.toHaveBeenCalled();
  await tick();
  expect(cb).toHaveBeenCalledTimes(1);
});

test('multiple changes in one microtask coalesce; deleteRule works', async () => {
  const s = document.createElement('style');
  document.head.append(s);
  const cb = vi.fn();
  s.addEventListener('darkext:sheet-changed', cb);
  s.sheet!.insertRule('.a{color:red}', 0);
  s.sheet!.insertRule('.b{color:red}', 0);
  s.sheet!.deleteRule(0);
  await tick();
  expect(cb).toHaveBeenCalledTimes(1);
  expect(s.sheet!.cssRules.length).toBe(1);
});

test('out-of-range insertRule still throws and does not notify', async () => {
  const s = document.createElement('style');
  document.head.append(s);
  const cb = vi.fn();
  s.addEventListener('darkext:sheet-changed', cb);
  expect(() => s.sheet!.insertRule('.a{color:red}', 99)).toThrow(DOMException);
  await tick();
  expect(cb).not.toHaveBeenCalled();
});

test('wrapper keeps name and length', () => {
  expect(CSSStyleSheet.prototype.insertRule.name).toBe('insertRule');
  expect(CSSStyleSheet.prototype.insertRule.length).toBe(1);
  expect(Element.prototype.attachShadow.name).toBe('attachShadow');
});

test('nested shadow: darkext:shadow reaches document, target is inner host', () => {
  const outer = document.createElement('div');
  document.body.append(outer);
  const root = outer.attachShadow({ mode: 'open' });
  const inner = document.createElement('div');
  root.append(inner);
  const first: unknown[] = [];
  const cb = vi.fn((e: Event) => first.push(e.composedPath()[0]));
  document.addEventListener('darkext:shadow', cb);
  inner.attachShadow({ mode: 'open' });
  document.removeEventListener('darkext:shadow', cb);
  expect(cb).toHaveBeenCalledTimes(1);
  expect(first[0]).toBe(inner);
});

test('style inside shadow root: sheet-changed reaches document', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  root.append(style);
  const first: unknown[] = [];
  const cb = vi.fn((e: Event) => first.push(e.composedPath()[0]));
  document.addEventListener('darkext:sheet-changed', cb);
  style.sheet!.insertRule('.q{color:red}', 0);
  await tick();
  document.removeEventListener('darkext:sheet-changed', cb);
  expect(cb).toHaveBeenCalledTimes(1);
  expect(first[0]).toBe(style);
});

test('replace() notifies only after its promise fulfils and returns the original promise', async () => {
  const proto = CSSStyleSheet.prototype as unknown as Record<string, unknown>;
  const saved = Object.getOwnPropertyDescriptor(proto, 'replace');
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  Object.defineProperty(proto, 'replace', { value: () => promise, writable: true, configurable: true });
  vi.resetModules();
  delete (window as unknown as Record<string, unknown>).__darkextHooked;
  await import('./hook');
  try {
    const s = document.createElement('style');
    document.head.append(s);
    const cb = vi.fn();
    s.addEventListener('darkext:sheet-changed', cb);
    const ret = (s.sheet as unknown as { replace(c: string): Promise<void> }).replace('a{}');
    expect(ret).toBe(promise);
    await tick();
    expect(cb).not.toHaveBeenCalled();
    resolve();
    await promise;
    await tick();
    expect(cb).toHaveBeenCalledTimes(1);
  } finally {
    if (saved) Object.defineProperty(proto, 'replace', saved);
    else delete proto.replace;
  }
});
