import { shouldApply, type ApplyStatus, type EffectiveConfig } from '../core/settings/resolve';
import { deepEqual } from '../shared/deep-equal';
import type { TabState } from '../shared/messages';
import { scheduleFrame } from './pipeline/observer';
import type { Pipeline } from './pipeline/pipeline';

export interface ControllerDeps {
  getConfig(): Promise<EffectiveConfig | null>; report(s: TabState): void;
  pipeline: Pipeline; matchDark(): { matches: boolean; onChange(cb: () => void): void };
  detect(): 'dark' | 'light' | 'unsure'; onDomReady(cb: () => void): void; onLoad(cb: () => void): void;
  /** Runs `cb` at the next animation frame (CONFIG_CHANGED coalescing); default requestAnimationFrame. */
  nextFrame?(cb: () => void): void;
}

export function createController(doc: Document, deps: ControllerDeps) {
  const { pipeline } = deps;
  const sys = deps.matchDark();
  const nextFrame = deps.nextFrame ?? ((cb: () => void) => { scheduleFrame(cb); });
  let cfg: EffectiveConfig | null = null;
  /** A config (possibly null) has been applied at least once. */
  let hasCfg = false;
  /** A CONFIG_CHANGED arrived: it is newer than any GET_CONFIG answer still on its way. */
  let pushed = false;
  /** Latest CONFIG_CHANGED waiting for the next frame. */
  let queued: { cfg: EffectiveConfig | null } | null = null;
  let listening = false;
  let detectionArmed = false;
  let pageIsDark: boolean | null = null;
  let applied = false;
  let stopped = false;
  let domReady = false;
  let detectionRan = false;
  let lastKey = '';
  let lastBase: { apply: boolean; status: ApplyStatus } | null = null;

  const removePlaceholder = () => doc.querySelectorAll('[data-darkext=placeholder]').forEach((n) => n.remove());

  function report(state: TabState): void {
    const key = `${state.status}|${state.detectedDark}`;
    if (key === lastKey) return;
    lastKey = key;
    deps.report(state);
  }

  function evaluate(): void {
    if (stopped) return;
    if (!cfg) {
      pipeline.detach(); applied = false;
      removePlaceholder();
      lastBase = null;
      report({ status: 'unsupported', detectedDark: false });
      return;
    }
    const r = shouldApply(cfg, { systemDark: sys.matches, pageIsDark });
    if (r.apply) {
      if (applied) pipeline.update(cfg); else { pipeline.start(cfg); applied = true; }
    } else {
      pipeline.detach(); applied = false;
    }
    removePlaceholder();
    lastBase = r;
    refreshReport();
  }

  /** Reports the current verdict, replacing it with the pipeline's heavy/error status while applied. */
  function refreshReport(): void {
    if (stopped || !lastBase) return;
    const ps = pipeline.status();
    report({ status: lastBase.apply && ps !== 'ok' ? ps : lastBase.status, detectedDark: pageIsDark === true });
  }

  /** Runs with our styles off (all in one synchronous task) so the page's own colours are measured. */
  function runDetection(): void {
    if (stopped || !cfg || cfg.ignoreDetection) return;
    detectionRan = true;
    pipeline.setDisabled(true);
    let verdict: 'dark' | 'light' | 'unsure' = 'unsure';
    try { verdict = deps.detect(); } finally { pipeline.setDisabled(false); }
    if (verdict === 'unsure') { deps.onLoad(retryOnLoad); return; }
    pageIsDark = verdict === 'dark';
    evaluate();
  }
  function retryOnLoad(): void {
    if (stopped || !cfg || cfg.ignoreDetection) return;
    pipeline.setDisabled(true);
    let verdict: 'dark' | 'light' | 'unsure' = 'unsure';
    try { verdict = deps.detect(); } finally { pipeline.setDisabled(false); }
    if (verdict === 'unsure') return;
    pageIsDark = verdict === 'dark';
    evaluate();
  }

  /** Applies a config from either source; listeners and detection are set up by whichever comes first. */
  function apply(next: EffectiveConfig | null): void {
    if (stopped) return;
    if (hasCfg && deepEqual(cfg, next)) return; // nothing changed: no update
    cfg = next;
    hasCfg = true;
    if (!listening) {
      listening = true;
      sys.onChange(evaluate);
      pipeline.onStatus(() => { refreshReport(); });
    }
    evaluate();
    if (!detectionArmed) {
      detectionArmed = true;
      deps.onDomReady(() => { domReady = true; runDetection(); });
    } else if (domReady && !detectionRan) {
      runDetection();
    }
  }

  function flushQueued(): void {
    const q = queued;
    queued = null;
    if (q) apply(q.cfg);
  }

  return {
    async start(): Promise<void> {
      let first: EffectiveConfig | null;
      try {
        first = await deps.getConfig();
      } catch {
        // Config unavailable (not "unsupported"): leave the page alone, drop the placeholder, report an error.
        // A CONFIG_CHANGED (already applied or queued) still takes over.
        if (stopped || pushed) return;
        removePlaceholder();
        report({ status: 'error', detectedDark: false });
        return;
      }
      if (stopped || pushed) return; // a CONFIG_CHANGED during the request is newer than this answer
      apply(first);
    },
    /** Coalesced: only the latest config of a frame is applied, and one equal to the current is ignored. */
    onConfig(next: EffectiveConfig | null): void {
      if (stopped) return;
      pushed = true;
      if (!queued) nextFrame(flushQueued);
      queued = { cfg: next };
    },
    stop(): void { stopped = true; },
  };
}
