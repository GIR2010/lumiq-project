import { classifyDarkness } from '../core/detect';
import type { EffectiveConfig } from '../core/settings/resolve';
import { sendToBackground, type ContentMessage } from '../shared/messages';
import { createController } from './controller';
import { readSchemeSignals, sampleBackgrounds } from './detector';
import { createMessenger, isInvalidated } from './messaging';
import { createPipeline } from './pipeline/pipeline';


let controller: ReturnType<typeof createController> | null = null;
let dead = false;

function die(): void {
  dead = true;
  controller?.stop();
  try { pipeline.freeze(); } catch { /* never throw into the page */ }
  document.removeEventListener('darkext:shadow', onShadowG, true);
  document.removeEventListener('darkext:adopted', onAdoptedG, true);
  document.removeEventListener('darkext:sheet-changed', onSheetG, true);
}

const messenger = createMessenger({ sendMessage: sendToBackground, wait: (ms) => new Promise((r) => setTimeout(r, ms)), onInvalidated: die });
const { send } = messenger;

const pipeline = createPipeline(document, { fetchCss: messenger.fetchCss });

const mql = window.matchMedia('(prefers-color-scheme: dark)');
controller = createController(document, {
  getConfig: () => send({ type: 'GET_CONFIG' }, true).catch((e) => {
    if (!isInvalidated(e)) console.warn('[DarkExt] GET_CONFIG failed', e);
    throw e;
  }),
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

function realTarget(e: Event): EventTarget | undefined {
  return e.composedPath()[0];
}
function onShadow(e: Event): void {
  const sr = (realTarget(e) as Element | undefined)?.shadowRoot;
  if (!sr) return;
  pipeline.addRoot(sr);
}
function onAdopted(e: Event): void {
  const t = realTarget(e);
  if (t instanceof Document) pipeline.adoptedChanged(t);
  else if (t instanceof Element && t.shadowRoot) pipeline.adoptedChanged(t.shadowRoot);
}
function onSheetChanged(e: Event): void {
  const t = realTarget(e);
  if (t instanceof Document) {
    pipeline.adoptedChanged(); // an ownerless (constructed) sheet changed: it may be adopted anywhere
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

controller.start().catch((e) => { if (isInvalidated(e)) die(); });
