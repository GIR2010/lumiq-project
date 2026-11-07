import type { EffectiveConfig } from '../core/settings/resolve';
import { deepEqual } from '../shared/deep-equal';

/**
 * Per tab, the config last delivered with CONFIG_CHANGED, so an identical one is not sent again.
 * Forgotten when the tab navigates or closes, and on GET_CONFIG (a fresh content script).
 */
export class SentConfigs {
  private last = new Map<number, EffectiveConfig>();

  constructor() {
    chrome.tabs.onRemoved.addListener((tabId: number) => this.forget(tabId));
    chrome.tabs.onUpdated.addListener((tabId: number, info: { status?: string; url?: string }) => {
      if (info.status === 'loading' || info.url !== undefined) this.forget(tabId);
    });
  }

  isNew(tabId: number, config: EffectiveConfig): boolean {
    return !deepEqual(this.last.get(tabId), config);
  }

  remember(tabId: number, config: EffectiveConfig): void {
    this.last.set(tabId, config);
  }

  forget(tabId: number): void {
    this.last.delete(tabId);
  }
}
