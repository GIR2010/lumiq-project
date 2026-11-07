import { buildBaseCss, buildFallbackCss } from '../../core/css/base';
import { VarRoleCounter, VarRoleTable } from '../../core/css/vars';
import { createAdaptiveMapper } from '../../core/mapping/adaptive';
import { createColorFn } from '../../core/mapping/color-fn';
import type { ColorFn, ColorMapper } from '../../core/mapping/types';
import type { EffectiveConfig } from '../../core/settings/resolve';
import { InlineStyler } from './inline';
import { buildMirrorCss } from './mirror';
import { isOwnNode, isStylesheetLink, observeRoot, scheduleFrame, type ObserverHandlers } from './observer';
import { runChunked } from './scheduler';
import { countVarUsage, extractImports, parseCssText, readRules } from './sheets';
import { StyleWriter } from './writer';

export interface PipelineDeps {
  fetchCss(url: string): Promise<string>;
  /** Clock for the budgets (default `performance.now`); injectable for tests. */
  now?: () => number;
}
export type PipelineStatus = 'ok' | 'heavy' | 'error';
export interface Pipeline {
  start(cfg: EffectiveConfig): void; update(cfg: EffectiveConfig): void; detach(): void;
  /** Stops observing without restoring the page (extension context invalidated). */
  freeze(): void;
  setDisabled(disabled: boolean): void; addRoot(root: ShadowRoot): void; refreshSheet(sheet: CSSStyleSheet): void;
  /** A root's adoptedStyleSheets were assigned or (no root: any) adopted sheet changed; re-checked once per frame. */
  adoptedChanged(root?: Document | ShadowRoot): void;
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
/** The anti-flash fallback is removed after this long at the latest. */
const FALLBACK_MS = 2000;
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
  const roots = new Set<ShadowRoot>();
  /** Every root whose adoptedStyleSheets hold a given (ownerless) page sheet; its mirror goes into each. */
  const adoptedRoots = new Map<CSSStyleSheet, Set<Root>>();
  const observers = new Map<Root, () => void>();
  /** Elements waiting for `load`, with the function that removes the listeners. */
  const waiting = new Map<Element, () => void>();
  /** Raw cross-origin CSS by URL; survives update/detach so nothing is fetched twice. */
  const rawCss = new Map<string, Promise<string>>();
  const statusListeners: Array<(s: PipelineStatus) => void> = [];
  /** Sources that currently have a mirror. */
  const mirrored = new Set<Source>();
  /** Variable roles from per-source usage counts, and the variables each source defines. */
  const vars = new VarRoleTable();
  const varDefs = new Map<Source, Set<string>>();
  /** Mirrored sources whose variables changed role: rebuilt once, at the end of the frame. */
  const pendingRebuild = new Set<Source>();
  /** Sheets reported changed (CSS-in-JS): re-processed once per frame. */
  const pendingRefresh = new Set<CSSStyleSheet>();
  /** Roots whose adopted sheets are re-checked at the next frame (`allAdopted`: every root). */
  const pendingRoots = new Set<Root>();
  let allAdopted = false;
  let cancelFrame: (() => void) | null = null;
  const now = deps.now ?? (() => performance.now());

  let running = false;
  let disabled = false;
  let fn: ColorFn | null = null;
  let current: PipelineStatus = 'ok';
  /** Bumped by start/detach: async work from an older session is dropped. */
  let session = 0;
  /** Bumped by every schedule and by detach: chunks of an older run become no-ops. */
  let runId = 0;
  /**
   * Load window: from start until the sheets known at `load` are processed. Only first builds inside
   * it are charged to the budget, and only exceeding it there makes the status 'heavy'.
   */
  let windowOpen = false;
  let spentMs = 0;
  let exceeded = false;
  /** Sources processed at least once (mirror written or nothing to mirror) / given up on, this session. */
  const built = new Set<Source>();
  const failed = new Set<Source>();
  /** Document sources not finished when `load` came: the window closes once they are. */
  let loadWait: Set<Source> | null = null;
  /** Document sources not finished at DOMContentLoaded: the fallback is removed once they are. */
  let dclWait: Set<Source> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Runs `f`; inside the load window its time is charged to the budget, and crossing it makes the status 'heavy'. */
  function charge(f: () => void, t0 = now()): void {
    if (!windowOpen) {
      f();
      return;
    }
    try {
      f();
    } finally {
      spentMs += now() - t0;
      if (running && windowOpen && !exceeded && spentMs >= BUDGET_MS) {
        exceeded = true;
        setStatus('heavy');
      }
    }
  }

  /** First builds are charged; rebuilds of processed sources (update, refresh, role changes) never are. */
  function chargeFirst(source: Source, f: () => void): void {
    if (built.has(source)) f(); else charge(f);
  }

  /** Over budget inside the load window, sheets not processed yet are dropped (processed ones are still rebuilt). */
  function blocked(source: Source): boolean {
    if (!windowOpen || !exceeded || built.has(source)) return false;
    settle(source, false);
    setStatus('heavy');
    return true;
  }

  // --- progress: which sources are finished ---

  function settle(source: Source, ok: boolean): void {
    if (ok) { built.add(source); failed.delete(source); } else failed.add(source);
    release(source);
  }

  /** The source no longer holds back the load window (finished, failed or gone). */
  function release(source: Source): void {
    if (dclWait?.delete(source) && !dclWait.size) dropFallback();
    if (loadWait?.delete(source) && !loadWait.size) closeWindow();
  }

  function unfinished(): Set<Source> {
    return new Set(sourcesOf(doc).filter((s) => !built.has(s) && !failed.has(s)));
  }

  function closeWindow(): void {
    windowOpen = false;
    loadWait = null;
  }

  function dropFallback(): void {
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    fallbackTimer = null;
    dclWait = null;
    writer.removeFallback();
  }

  /** Takes the DOMContentLoaded snapshot (fallback) and the `load` snapshot (load window) once reached. */
  function checkReadiness(): void {
    if (!running) return;
    if (doc.readyState !== 'loading' && writer.hasFallback() && !dclWait) {
      dclWait = unfinished();
      if (!dclWait.size) dropFallback();
    }
    if (doc.readyState === 'complete' && windowOpen && !loadWait) {
      loadWait = unfinished();
      if (!loadWait.size) closeWindow();
    }
  }

  const onReadyState = () => guard(checkReadiness);

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

  function countRules(rules: CSSRuleList, counts: VarRoleCounter, defs: Set<string>, depth = 0): void {
    forEachImport(rules, depth, (r) => countRules(r, counts, defs, depth + 1));
    countVarUsage(rules, counts, defs);
  }

  function mirrorCss(rules: CSSRuleList, colorFn: ColorFn, depth = 0): string {
    let css = '';
    forEachImport(rules, depth, (r, media) => {
      const inner = mirrorCss(r, colorFn, depth + 1);
      css += media && inner ? `@media ${media}{${inner}}` : inner;
    });
    return css + buildMirrorCss(rules, colorFn, vars);
  }

  /** Replaces the source's variable counts; returns the variables whose role changed. */
  function count(item: Item): Set<string> {
    const rules = rulesOf(item);
    const counts = new VarRoleCounter();
    const defs = new Set<string>();
    if (rules) countRules(rules, counts, defs);
    varDefs.set(item.source, defs);
    return vars.set(item.source, counts);
  }

  /** Mirrored sources defining a variable whose role changed are rebuilt at the end of the frame. */
  function rebuildDefiners(names: Set<string>, except?: ReadonlySet<Source>): void {
    if (!names.size) return;
    for (const [source, defs] of varDefs) {
      if (except?.has(source) || !mirrored.has(source)) continue;
      for (const n of names) {
        if (defs.has(n)) { pendingRebuild.add(source); break; }
      }
    }
    if (pendingRebuild.size) requestFrame();
  }

  function flushRebuilds(): void {
    const list = [...pendingRebuild];
    pendingRebuild.clear();
    for (const source of list) {
      const entry = entries.get(source);
      if (running && entry && mirrored.has(source)) build({ source, entry });
    }
  }

  function requestFrame(): void {
    if (!cancelFrame) cancelFrame = scheduleFrame(() => guard(flushFrame));
  }

  function flushFrame(): void {
    cancelFrame = null;
    if (!running) return;
    if (pendingRefresh.size || pendingRoots.size || allAdopted) {
      pruneRoots();
      const all: Root[] = [doc, ...roots];
      all.forEach(pruneAdopted);
      for (const r of allAdopted ? all : pendingRoots) {
        if (r !== doc && !roots.has(r as ShadowRoot)) continue;
        for (const s of r.adoptedStyleSheets) if (!writer.owns(s)) pendingRefresh.add(s);
      }
      pendingRoots.clear();
      allAdopted = false;
      const sheets = [...pendingRefresh];
      pendingRefresh.clear();
      sheets.forEach(refreshNow);
    }
    flushRebuilds();
  }

  function unmirror(source: Source): void {
    mirrored.delete(source);
    writer.removeMirror(source);
  }

  /** Drops what is known about the source; `done`: it no longer holds back the waits (gone or given up). */
  function forget(source: Source, done = true): void {
    if (done) release(source);
    entries.delete(source);
    if (!(source instanceof Element)) adoptedRoots.delete(source);
    varDefs.delete(source);
    pendingRebuild.delete(source);
    rebuildDefiners(vars.delete(source));
    unmirror(source);
  }

  function build(item: Item): void {
    const { source, entry } = item;
    if (!fn || entries.get(source) !== entry || blocked(source)) return;
    if (source instanceof Element && !source.isConnected) {
      forget(source);
      return;
    }
    const rules = rulesOf(item);
    if (!rules) return;
    const css = mirrorCss(rules, fn);
    settle(source, true);
    if (!css) {
      unmirror(source);
      return;
    }
    mirrored.add(source);
    writer.setMirror(source, css, source instanceof Element ? [entry.root] : (adoptedRoots.get(source) ?? [entry.root]));
  }

  /** Count + build right away (observer, load, fetch, refresh paths); a first build is charged to the budget. */
  function processNow(item: Item | null): void {
    if (!item || blocked(item.source)) return;
    chargeFirst(item.source, () => {
      const changed = count(item);
      build(item);
      rebuildDefiners(changed, new Set([item.source]));
    });
  }

  // --- resolving sources (pending / cross-origin / readable) ---

  function waitLoad(el: Element, root: Root): void {
    if (waiting.has(el)) return;
    const stop = () => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
      waiting.delete(el);
    };
    const onLoad = () => {
      stop();
      guard(() => { if (running) processNow(resolve(el, root)); });
    };
    const onError = () => {
      stop();
      guard(() => { if (running) settle(el, false); });
    };
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
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
        if ((source instanceof Element && !source.isConnected) || sheetOf(source)?.href !== url) {
          release(source); // gone or replaced meanwhile
          return;
        }
        const entry: Entry = { root, parsed: parseCssText(text) };
        entries.set(source, entry);
        processNow({ source, entry });
      }),
      // Fetch failed: the sheet is skipped, status unchanged.
      () => guard(() => { if (s === session && running) settle(source, false); }),
    );
  }

  function resolve(source: Source, root: Root): Item | null {
    const sheet = sheetOf(source);
    if (!sheet) {
      // A <link> without a sheet is still loading: it keeps holding back the fallback and the load window.
      const loading = source instanceof Element && isStylesheetLink(source);
      forget(source, false);
      if (loading) waitLoad(source, root); else settle(source, false);
      return null;
    }
    if (sheet.disabled) {
      forget(source, false);
      settle(source, false);
      return null;
    }
    const rules = readRules(sheet);
    if (rules === 'pending') {
      if (source instanceof Element) waitLoad(source, root);
      return null;
    }
    if (rules === 'cross-origin') {
      if (sheet.href) loadCrossOrigin(source, sheet.href, root);
      else settle(source, false);
      return null;
    }
    const entry: Entry = { root, parsed: null };
    entries.set(source, entry);
    if (!(source instanceof Element)) {
      let held = adoptedRoots.get(source);
      if (!held) adoptedRoots.set(source, (held = new Set()));
      held.add(root);
    }
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
    for (const sheet of root.adoptedStyleSheets ?? []) if (!writer.owns(sheet)) push(sheet);
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

  /** The root no longer holds the sheet: its mirror leaves that root (and the sheet is forgotten once no root holds it). */
  function unhold(sheet: CSSStyleSheet, root: Root): void {
    const held = adoptedRoots.get(sheet);
    if (!held?.delete(root)) return;
    if (held.size) writer.dropRoot(sheet, root); else forget(sheet);
  }

  function pruneAdopted(root: Root): void {
    for (const [sheet, held] of [...adoptedRoots]) {
      if (held.has(root) && !root.adoptedStyleSheets.includes(sheet)) unhold(sheet, root);
    }
  }

  /** Shadow roots whose host left the document are no longer watched (checked once per frame flush). */
  function pruneRoots(): void {
    for (const r of [...roots]) {
      if (r.host.isConnected) continue;
      roots.delete(r);
      observers.get(r)?.();
      observers.delete(r);
      for (const sheet of [...adoptedRoots.keys()]) unhold(sheet, r);
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
  function schedule(items: Item[], styled: Element[], startedAt: number): void {
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
    const buildTask = (i: Item) => task(() => chargeFirst(i.source, () => build(i)));
    const tasks = [...head.slice(0, n).map(buildTask), ...inlineTasks, ...head.slice(n).map(buildTask), ...rest.map(buildTask)];
    // The total budget is build time inside the load window (charge/blocked), not wall-clock time.
    runChunked(tasks, { syncCount: n + inlineTasks.length, budgetMs: Infinity, syncBudgetMs: FIRST_PASS_MS, startedAt, now }).then(
      () => {},
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
      onFlushed: () => guard(() => { if (running) flushRebuilds(); }),
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
    const changed = new Set<string>();
    charge(() => items.forEach((i) => count(i).forEach((n) => changed.add(n))));
    for (const item of items) charge(() => build(item));
    rebuildDefiners(changed, new Set(items.map((i) => i.source)));
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
      const t0 = now(); // resolving and counting are charged to the first pass
      running = true;
      session++;
      windowOpen = true;
      spentMs = 0;
      exceeded = false;
      built.clear();
      failed.clear();
      loadWait = null;
      fn = makeColorFn(cfg);
      writer.setBase(buildBaseCss(cfg.colors, fn, cfg.adj));
      // Replaces the placeholder: html/body stay dark until the sheets known at DOMContentLoaded are mirrored.
      writer.setFallback(buildFallbackCss(fn));
      fallbackTimer = setTimeout(() => guard(dropFallback), FALLBACK_MS);
      let items: Item[] = [];
      charge(() => {
        items = resolveAll(doc);
        items.forEach(count);
      }, t0);
      schedule(items, styledIn(doc), t0);
      observe(doc);
      for (const r of [...roots]) {
        if (r.host.isConnected) attachRoot(r);
        else roots.delete(r);
      }
      doc.addEventListener('readystatechange', onReadyState);
      checkReadiness();
    });
  }

  function update(cfg: EffectiveConfig): void {
    if (!running) {
      start(cfg);
      return;
    }
    guard(() => {
      const t0 = now();
      setStatus(exceeded ? 'heavy' : 'ok'); // 'heavy' only ever comes from the load window
      fn = makeColorFn(cfg);
      // Variable counts are kept per source and are independent of the config: no recount.
      pendingRebuild.clear();
      const items = [...entries].map(([source, entry]) => ({ source, entry }));
      writer.setBase(buildBaseCss(cfg.colors, fn, cfg.adj));
      if (writer.hasFallback()) writer.setFallback(buildFallbackCss(fn));
      inline.restoreAll(); // apply() skips elements it already styled; start again from the originals
      schedule(items, allStyled(), t0);
    });
  }

  const safe = (f: () => void) => { try { f(); } catch (e) { console.error('[DarkExt]', e); } };

  /** Stops everything that reacts to the page (observers, listeners, timers, queued work). */
  function stopWork(): void {
    running = false;
    session++;
    runId++;
    closeWindow();
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    fallbackTimer = null;
    dclWait = null;
    doc.removeEventListener('readystatechange', onReadyState);
    for (const stop of observers.values()) safe(stop);
    observers.clear();
    for (const stop of [...waiting.values()]) safe(stop);
    waiting.clear();
    pendingRebuild.clear();
    pendingRefresh.clear();
    pendingRoots.clear();
    allAdopted = false;
    cancelFrame?.();
    cancelFrame = null;
  }

  function detach(): void {
    stopWork();
    fn = null;
    safe(() => inline.restoreAll());
    safe(() => writer.clear());
    entries.clear();
    mirrored.clear();
    vars.clear();
    varDefs.clear();
    adoptedRoots.clear();
  }

  /**
   * Extension context gone: stop reacting to the page but leave it as it is (spec §7). Only the
   * transient fallback goes, since nothing could remove it any more.
   */
  function freeze(): void {
    stopWork();
    safe(() => writer.removeFallback());
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

  /** Runs inside the frame flush, after roots and adopted holdings were pruned. */
  function refreshNow(sheet: CSSStyleSheet): void {
    if (!running || writer.owns(sheet)) return;
    const node = sheet.ownerNode;
    if (node) {
      if (node.nodeType !== Node.ELEMENT_NODE || isOwnNode(node) || !node.isConnected) return;
      processNow(resolve(node as Element, node.getRootNode() as Root));
      return;
    }
    const holders = [doc, ...roots].filter((r) => r.adoptedStyleSheets.includes(sheet));
    if (!holders.length) return;
    for (const r of holders.slice(1)) resolve(sheet, r); // registers the other holders; the first is built below
    processNow(resolve(sheet, holders[0]));
  }

  /** Coalesced: however often a sheet is reported within a frame, it is re-processed once. */
  function refreshSheet(sheet: CSSStyleSheet): void {
    if (!running || writer.owns(sheet)) return;
    pendingRefresh.add(sheet);
    requestFrame();
  }

  function adoptedChanged(root?: Root): void {
    if (!running) return;
    if (root) pendingRoots.add(root); else allAdopted = true;
    requestFrame();
  }

  return {
    start, update, detach, freeze, setDisabled, addRoot, refreshSheet, adoptedChanged,
    status: () => current,
    onStatus: (cb) => { statusListeners.push(cb); },
  };
}
