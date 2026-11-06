import { shouldApply, type ApplyStatus, type EffectiveConfig } from '../core/settings/resolve';
import type { TabState } from '../shared/messages';
import type { Pipeline } from './pipeline/pipeline';

export interface ControllerDeps {
  getConfig(): Promise<EffectiveConfig | null>; report(s: TabState): void;
  pipeline: Pipeline; matchDark(): { matches: boolean; onChange(cb: () => void): void };
  detect(): 'dark' | 'light' | 'unsure'; onDomReady(cb: () => void): void; onLoad(cb: () => void): void;
}

export function createController(doc: Document, deps: ControllerDeps) {
  const { pipeline } = deps;
  const sys = deps.matchDark();
  let cfg: EffectiveConfig | null = null;
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

  return {
    async start(): Promise<void> {
      cfg = await deps.getConfig();
      if (stopped) return;
      sys.onChange(evaluate);
      pipeline.onStatus(() => { refreshReport(); });
      evaluate();
      deps.onDomReady(() => { domReady = true; runDetection(); });
    },
    onConfig(next: EffectiveConfig | null): void {
      if (stopped) return;
      cfg = next;
      evaluate();
      if (domReady && !detectionRan) runDetection();
    },
    stop(): void { stopped = true; },
  };
}
