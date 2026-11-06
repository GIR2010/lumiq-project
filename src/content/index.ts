import { classifyDarkness } from '../core/detect';
import type { EffectiveConfig } from '../core/settings/resolve';
import { sendToBackground, type ContentMessage, type Request, type ResponseOf } from '../shared/messages';
import { createController } from './controller';
import { readSchemeSignals, sampleBackgrounds } from './detector';
import { createPipeline } from './pipeline/pipeline';

const INVALIDATED = /extension context invalidated/i;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let controller: ReturnType<typeof createController> | null = null;
let dead = false;
const shadowRoots = new Set<WeakRef<ShadowRoot>>();

function die(): void {
  dead = true;
  controller?.stop();
  document.removeEventListener('darkext:shadow', onShadowG, true);
  document.removeEventListener('darkext:adopted', onAdoptedG, true);
  document.removeEventListener('darkext:sheet-changed', onSheetG, true);
}

/** Sends to the service worker; one retry after 100 ms (it may be waking up). Invalidated context → stop quietly. */
async function send<R extends Request>(msg: R, retry = false): Promise<ResponseOf<R>> {
  try {
    return await sendToBackground(msg);
  } catch (e) {
    if (INVALIDATED.test(errText(e))) { die(); throw e; }
    if (!retry) throw e;
    await wait(100);
    try {
      return await sendToBackground(msg);
    } catch (e2) {
      if (INVALIDATED.test(errText(e2))) die();
      throw e2;
    }
  }
}

const pipeline = createPipeline(document, {
  async fetchCss(url) {
    const res = await send({ type: 'FETCH_CSS', url });
    if ('error' in res) throw new Error(res.error);
    return res.text;
  },
});

const mql = window.matchMedia('(prefers-color-scheme: dark)');
controller = createController(document, {
  getConfig: () => send({ type: 'GET_CONFIG' }, true).catch(() => null),
  report: (state) => { send({ type: 'REPORT_STATE', state }).catch(() => {}); },
  pipeline,
  matchDark: () => ({ get matches() { return mql.matches; }, onChange: (cb) => mql.addEventListener('change', cb) }),
  detect: () => classifyDarkness({
    samples: sampleBackgrounds(document, window), ...readSchemeSignals(document, window), systemDark: mql.matches,
  }),
  onDomReady: (cb) => {
    if (document.readyState !== 'loading') cb(); else document.addEventListener('DOMContentLoaded', cb, { once: true });
  },
  onLoad: (cb) => {
    if (document.readyState === 'complete') cb(); else window.addEventListener('load', cb, { once: true });
  },
});

function rescanAdopted(root: Document | ShadowRoot): void {
  for (const sheet of root.adoptedStyleSheets) pipeline.refreshSheet(sheet);
}

function realTarget(e: Event): EventTarget | undefined {
  return e.composedPath()[0];
}
function onShadow(e: Event): void {
  const sr = (realTarget(e) as Element | undefined)?.shadowRoot;
  if (!sr) return;
  shadowRoots.add(new WeakRef(sr));
  pipeline.addRoot(sr);
}
function onAdopted(e: Event): void {
  const t = realTarget(e);
  if (t instanceof Document) rescanAdopted(t);
  else if (t instanceof Element && t.shadowRoot) rescanAdopted(t.shadowRoot);
}
function onSheetChanged(e: Event): void {
  const t = realTarget(e);
  if (t instanceof Document) {
    rescanAdopted(t);
    for (const ref of shadowRoots) {
      const sr = ref.deref();
      if (sr) rescanAdopted(sr); else shadowRoots.delete(ref);
    }
  } else if (t instanceof HTMLStyleElement || t instanceof HTMLLinkElement) {
    if (t.sheet) pipeline.refreshSheet(t.sheet);
  }
}
// Every handler is guarded: nothing may throw into the page.
const guarded = (f: (e: Event) => void) => (e: Event) => { if (dead) return; try { f(e); } catch { /* ignore */ } };
const onShadowG = guarded(onShadow), onAdoptedG = guarded(onAdopted), onSheetG = guarded(onSheetChanged);
document.addEventListener('darkext:shadow', onShadowG, true);
document.addEventListener('darkext:adopted', onAdoptedG, true);
document.addEventListener('darkext:sheet-changed', onSheetG, true);

try {
  chrome.runtime.onMessage.addListener((msg: ContentMessage) => {
    if (dead || msg?.type !== 'CONFIG_CHANGED') return;
    try { controller?.onConfig(msg.config as EffectiveConfig | null); } catch { /* ignore */ }
  });
} catch { die(); }

controller.start().catch((e) => { if (INVALIDATED.test(errText(e))) die(); });
