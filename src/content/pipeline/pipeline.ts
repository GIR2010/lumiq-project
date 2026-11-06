import { buildBaseCss } from '../../core/css/base';
import { VarRoleCounter } from '../../core/css/vars';
import { createAdaptiveMapper } from '../../core/mapping/adaptive';
import { createColorFn } from '../../core/mapping/color-fn';
import type { ColorFn, ColorMapper } from '../../core/mapping/types';
import type { EffectiveConfig } from '../../core/settings/resolve';
import { InlineStyler } from './inline';
import { buildMirrorCss } from './mirror';
import { isOwnNode, isStylesheetLink, observeRoot, type ObserverHandlers } from './observer';
import { runChunked } from './scheduler';
import { countVarUsage, extractImports, parseCssText, readRules } from './sheets';
import { StyleWriter } from './writer';

export interface PipelineDeps { fetchCss(url: string): Promise<string> }
export type PipelineStatus = 'ok' | 'heavy' | 'error';
export interface Pipeline {
  start(cfg: EffectiveConfig): void; update(cfg: EffectiveConfig): void; detach(): void;
  setDisabled(disabled: boolean): void; addRoot(root: ShadowRoot): void; refreshSheet(sheet: CSSStyleSheet): void;
  status(): PipelineStatus; onStatus(cb: (s: PipelineStatus) => void): void;
}

type Root = Document | ShadowRoot;
/** A sheet is identified by its owner element (<style>/<link>) or, when adopted, by the sheet itself. */
type Source = Element | CSSStyleSheet;
/** `parsed` holds rules of a cross-origin sheet (fetched and parsed by us); live sheets are re-read. */
interface Entry { root: Root; parsed: CSSRuleList | null }
interface Item { source: Source; entry: Entry }

const BUDGET_MS = 3000;
const FIRST_PASS_MS = 300;
const FIRST_PASS_RULES = 50_000;
const INLINE_BATCH = 500;
const MAX_IMPORT_DEPTH = 8;
const IMPORT_STATEMENT = /@import[^;{}]*;/gi;

/** Plan 1: both engines go through the adaptive mapper. Plan 2 swaps in the style mapper here. */
function createMapper(cfg: EffectiveConfig): ColorMapper {
  return createAdaptiveMapper(cfg.colors);
}

function sheetOf(source: Source): CSSStyleSheet | null {
  if (!(source instanceof Element)) return source;
  return ((source as HTMLStyleElement | HTMLLinkElement).sheet as CSSStyleSheet | null) ?? null;
}

/** Same-origin `@import` target of a rule, if the rule is an import. */
function importedSheet(rule: CSSRule): { sheet: CSSStyleSheet; media: string } | null {
  if (!('href' in rule) || !('styleSheet' in rule)) return null;
  const r = rule as CSSImportRule;
  return r.styleSheet ? { sheet: r.styleSheet, media: r.media?.mediaText ?? '' } : null;
}

export function createPipeline(doc: Document, deps: PipelineDeps): Pipeline {
  const writer = new StyleWriter(doc);
  const inline = new InlineStyler();
  const entries = new Map<Source, Entry>();
  /** Our own adopted mirror sheets: never treated as page sheets. */
  const ownSheets = new WeakSet<CSSStyleSheet>();
  const roots = new Set<ShadowRoot>();
  const observers = new Map<Root, () => void>();
  /** Elements waiting for `load`, with the function that removes the listeners. */
  const waiting = new Map<Element, () => void>();
  /** Raw cross-origin CSS by URL; survives update/detach so nothing is fetched twice. */
  const rawCss = new Map<string, Promise<string>>();
  const statusListeners: Array<(s: PipelineStatus) => void> = [];

  let running = false;
  let disabled = false;
  let fn: ColorFn | null = null;
  let vars = new VarRoleCounter();
  let current: PipelineStatus = 'ok';
  /** Bumped by start/detach: async work from an older session is dropped. */
  let session = 0;
  /** Bumped by every schedule and by detach: chunks of an older run become no-ops. */
  let runId = 0;

  function setStatus(s: PipelineStatus): void {
    if (s === current) return;
    current = s;
    for (const cb of statusListeners) {
      try { cb(s); } catch (e) { console.error('[DarkExt]', e); }
    }
  }

  function fail(e: unknown): void {
    console.error('[DarkExt]', e);
    detach();
    setStatus('error');
  }

  function guard(f: () => void): void {
    try { f(); } catch (e) { fail(e); }
  }

  // --- rules, counting, mirrors ---

  function rulesOf(item: Item): CSSRuleList | null {
    if (item.entry.parsed) return item.entry.parsed;
    const sheet = sheetOf(item.source);
    if (!sheet) return null;
    const r = readRules(sheet);
    return typeof r === 'string' ? null : r;
  }

  function forEachImport(rules: CSSRuleList, depth: number, f: (rules: CSSRuleList, media: string) => void): void {
    if (depth >= MAX_IMPORT_DEPTH) return;
    for (const rule of Array.from(rules)) {
      const imp = importedSheet(rule);
      if (!imp) continue;
      const r = readRules(imp.sheet);
      if (typeof r !== 'string') f(r, imp.media);
    }
  }

  function countRules(rules: CSSRuleList, depth = 0): void {
    forEachImport(rules, depth, (r) => countRules(r, depth + 1));
    countVarUsage(rules, vars);
  }

  function mirrorCss(rules: CSSRuleList, colorFn: ColorFn, depth = 0): string {
    let css = '';
    forEachImport(rules, depth, (r, media) => {
      const inner = mirrorCss(r, colorFn, depth + 1);
      css += media && inner ? `@media ${media}{${inner}}` : inner;
    });
    return css + buildMirrorCss(rules, colorFn, vars);
  }

  function count(item: Item): void {
    const rules = rulesOf(item);
    if (rules) countRules(rules);
  }

  function forget(source: Source): void {
    entries.delete(source);
    writer.removeMirror(source);
  }

  function build(item: Item): void {
    const { source, entry } = item;
    if (!fn || entries.get(source) !== entry) return;
    if (source instanceof Element && !source.isConnected) {
      forget(source);
      return;
    }
    const rules = rulesOf(item);
    if (!rules) return;
    const css = mirrorCss(rules, fn);
    if (!css) {
      writer.removeMirror(source);
      return;
    }
    if (source instanceof Element) {
      writer.setMirror(source, css, entry.root);
      return;
    }
    const before = new Set(entry.root.adoptedStyleSheets);
    writer.setMirror(source, css, entry.root);
    for (const s of entry.root.adoptedStyleSheets) if (!before.has(s)) ownSheets.add(s);
  }

  /** Count + build right away (observer, load, fetch, refresh paths). */
  function processNow(item: Item | null): void {
    if (!item) return;
    count(item);
    build(item);
  }

  // --- resolving sources (pending / cross-origin / readable) ---

  function waitLoad(el: Element, root: Root): void {
    if (waiting.has(el)) return;
    const stop = () => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', stop);
      waiting.delete(el);
    };
    const onLoad = () => {
      stop();
      guard(() => { if (running) processNow(resolve(el, root)); });
    };
    el.addEventListener('load', onLoad);
    el.addEventListener('error', stop);
    waiting.set(el, stop);
  }

  function fetchRaw(url: string): Promise<string> {
    let p = rawCss.get(url);
    if (!p) {
      p = Promise.resolve()
        .then(() => deps.fetchCss(url))
        .then((text) => {
          if (typeof text !== 'string') throw new Error(`no CSS text for ${url}`);
          return text;
        });
      rawCss.set(url, p);
      p.catch(() => rawCss.delete(url)); // a failed fetch may be retried by a later start
    }
    return p;
  }

  /** Fetched text with its @imports inlined in front (failed imports are skipped). */
  async function loadCss(url: string, seen: ReadonlySet<string>): Promise<string> {
    const raw = await fetchRaw(url);
    const next = new Set(seen).add(url);
    const imports = extractImports(raw, url).filter((u) => !next.has(u));
    const parts = await Promise.all(imports.map((u) => loadCss(u, next).catch(() => '')));
    return [...parts, raw.replace(IMPORT_STATEMENT, '')].join('\n');
  }

  function loadCrossOrigin(source: Source, url: string, root: Root): void {
    const s = session;
    loadCss(url, new Set()).then(
      (text) => guard(() => {
        if (s !== session || !running) return;
        if (source instanceof Element && !source.isConnected) return;
        if (sheetOf(source)?.href !== url) return; // the sheet was replaced meanwhile
        const entry: Entry = { root, parsed: parseCssText(text) };
        entries.set(source, entry);
        processNow({ source, entry });
      }),
      () => { /* fetch failed: the sheet is skipped, status unchanged */ },
    );
  }

  function resolve(source: Source, root: Root): Item | null {
    const sheet = sheetOf(source);
    if (!sheet) {
      forget(source);
      if (source instanceof Element && isStylesheetLink(source)) waitLoad(source, root);
      return null;
    }
    if (sheet.disabled) {
      forget(source);
      return null;
    }
    const rules = readRules(sheet);
    if (rules === 'pending') {
      if (source instanceof Element) waitLoad(source, root);
      return null;
    }
    if (rules === 'cross-origin') {
      if (sheet.href) loadCrossOrigin(source, sheet.href, root);
      return null;
    }
    const entry: Entry = { root, parsed: null };
    entries.set(source, entry);
    return { source, entry };
  }

  function sourcesOf(root: Root): Source[] {
    const out: Source[] = [];
    const seen = new Set<Source>();
    const push = (s: Source) => { if (!seen.has(s)) { seen.add(s); out.push(s); } };
    for (const sheet of Array.from(root.styleSheets)) {
      const node = sheet.ownerNode;
      if (!node) push(sheet as CSSStyleSheet);
      else if (node.nodeType === Node.ELEMENT_NODE && !isOwnNode(node)) push(node as Element);
    }
    // Links still loading are absent from styleSheets.
    for (const link of Array.from(root.querySelectorAll('link'))) if (isStylesheetLink(link)) push(link);
    for (const sheet of root.adoptedStyleSheets ?? []) if (!ownSheets.has(sheet)) push(sheet);
    return out;
  }

  function resolveAll(root: Root): Item[] {
    const items: Item[] = [];
    for (const source of sourcesOf(root)) {
      const item = resolve(source, root);
      if (item) items.push(item);
    }
    return items;
  }

  function pruneAdopted(root: Root): void {
    for (const [source, entry] of [...entries]) {
      if (entry.root === root && !(source instanceof Element) && !root.adoptedStyleSheets.includes(source)) forget(source);
    }
  }

  // --- inline styles ---

  function styledIn(root: Root): Element[] {
    return Array.from(root.querySelectorAll('[style]'));
  }

  function allStyled(): Element[] {
    return [doc, ...roots].flatMap(styledIn);
  }

  function applyInline(els: Element[]): void {
    if (!fn || disabled) return;
    for (const el of els) inline.apply(el, fn);
  }

  // --- scheduling ---

  function isInHead(source: Source): boolean {
    return source instanceof Element && !!doc.head && doc.head.contains(source);
  }

  /** <head> sheets (≤ FIRST_PASS_RULES) and inline styles go first and synchronously; the rest in idle chunks. */
  function schedule(items: Item[], styled: Element[]): void {
    const id = ++runId;
    const task = (f: () => void) => () => { if (id === runId && running) f(); };
    const head = items.filter((i) => isInHead(i.source));
    const rest = items.filter((i) => !isInHead(i.source));
    let n = 0;
    let ruleCount = 0;
    for (; n < head.length; n++) {
      const size = rulesOf(head[n])?.length ?? 0;
      if (ruleCount + size > FIRST_PASS_RULES) break;
      ruleCount += size;
    }
    const inlineTasks: Array<() => void> = [];
    if (!disabled) {
      for (let i = 0; i < styled.length; i += INLINE_BATCH) {
        const batch = styled.slice(i, i + INLINE_BATCH);
        inlineTasks.push(task(() => applyInline(batch)));
      }
    }
    const buildTask = (i: Item) => task(() => build(i));
    const tasks = [...head.slice(0, n).map(buildTask), ...inlineTasks, ...head.slice(n).map(buildTask), ...rest.map(buildTask)];
    runChunked(tasks, { syncCount: n + inlineTasks.length, budgetMs: BUDGET_MS, syncBudgetMs: FIRST_PASS_MS }).then(
      (res) => { if (id === runId && running && res === 'budget') setStatus('heavy'); },
      (e) => { if (id === runId && running) fail(e); },
    );
  }

  // --- roots and observers ---

  function handlersFor(root: Root): ObserverHandlers {
    return {
      onSheetNode: (n) => guard(() => {
        if (!running) return;
        processNow(resolve(n, root));
        if (root === doc) writer.ensureBaseFirst();
      }),
      onSheetNodeRemoved: (n) => guard(() => {
        if (!running) return;
        waiting.get(n)?.();
        forget(n);
      }),
      onStyleAttr: (el) => guard(() => { if (running) applyInline([el]); }),
      onHeadChange: () => guard(() => { if (running) writer.ensureBaseFirst(); }),
      isOwn: (r) => inline.isOwnMutation(r),
    };
  }

  function observe(root: Root): void {
    if (!observers.has(root)) observers.set(root, observeRoot(root, handlersFor(root)));
  }

  /** Shadow roots are small: processed synchronously. */
  function attachRoot(root: ShadowRoot): void {
    pruneAdopted(root);
    const items = resolveAll(root);
    items.forEach(count);
    items.forEach(build);
    applyInline(styledIn(root));
    observe(root);
  }

  function makeColorFn(cfg: EffectiveConfig): ColorFn {
    return createColorFn(createMapper(cfg), cfg.adj, cfg.colors);
  }

  // --- public API ---

  function start(cfg: EffectiveConfig): void {
    if (running) detach();
    setStatus('ok');
    guard(() => {
      running = true;
      session++;
      fn = makeColorFn(cfg);
      vars = new VarRoleCounter();
      writer.setBase(buildBaseCss(cfg.colors, fn, cfg.adj));
      const items = resolveAll(doc);
      items.forEach(count);
      schedule(items, styledIn(doc));
      observe(doc);
      for (const r of [...roots]) {
        if (r.host.isConnected) attachRoot(r);
        else roots.delete(r);
      }
    });
  }

  function update(cfg: EffectiveConfig): void {
    if (!running) {
      start(cfg);
      return;
    }
    guard(() => {
      setStatus('ok');
      fn = makeColorFn(cfg);
      vars = new VarRoleCounter();
      const items = [...entries].map(([source, entry]) => ({ source, entry }));
      items.forEach(count);
      writer.setBase(buildBaseCss(cfg.colors, fn, cfg.adj));
      inline.restoreAll(); // apply() skips elements it already styled; start again from the originals
      schedule(items, allStyled());
    });
  }

  function detach(): void {
    running = false;
    session++;
    runId++;
    fn = null;
    const safe = (f: () => void) => { try { f(); } catch (e) { console.error('[DarkExt]', e); } };
    for (const stop of observers.values()) safe(stop);
    observers.clear();
    for (const stop of [...waiting.values()]) safe(stop);
    waiting.clear();
    safe(() => inline.restoreAll());
    safe(() => writer.clear());
    entries.clear();
  }

  function setDisabled(d: boolean): void {
    if (d === disabled) return;
    disabled = d;
    guard(() => {
      writer.setDisabled(d);
      if (!running) return;
      // Inline colours are reverted too, so a detector sees the page's own colours.
      if (d) inline.restoreAll();
      else applyInline(allStyled());
    });
  }

  function addRoot(root: ShadowRoot): void {
    roots.add(root);
    if (running) guard(() => attachRoot(root));
  }

  function refreshSheet(sheet: CSSStyleSheet): void {
    guard(() => {
      if (!running || ownSheets.has(sheet)) return;
      const node = sheet.ownerNode;
      if (node) {
        if (node.nodeType !== Node.ELEMENT_NODE || isOwnNode(node) || !node.isConnected) return;
        processNow(resolve(node as Element, node.getRootNode() as Root));
        return;
      }
      const all: Root[] = [doc, ...roots];
      all.forEach(pruneAdopted);
      const root = all.find((r) => r.adoptedStyleSheets.includes(sheet));
      if (root) processNow(resolve(sheet, root));
    });
  }

  return {
    start, update, detach, setDisabled, addRoot, refreshSheet,
    status: () => current,
    onStatus: (cb) => { statusListeners.push(cb); },
  };
}
