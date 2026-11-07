import type { TabState } from '../shared/messages';

const key = (tabId: number) => `tab:${tabId}`;

/** Per-tab status kept in chrome.storage.session so it survives service-worker restarts. */
export class TabStateStore {
  constructor() {
    chrome.tabs.onRemoved.addListener((tabId: number) => {
      chrome.storage.session.remove(key(tabId)).catch((e: unknown) => {
        console.warn('[DarkExt] tab state cleanup failed', e);
      });
    });
  }

  async get(tabId: number): Promise<TabState | undefined> {
    try {
      const r = await chrome.storage.session.get(key(tabId));
      return r[key(tabId)] as TabState | undefined;
    } catch (e) {
      console.warn('[DarkExt] tab state read failed', e);
      return undefined;
    }
  }

  async set(tabId: number, s: TabState): Promise<void> {
    try {
      await chrome.storage.session.set({ [key(tabId)]: s });
    } catch (e) {
      console.warn('[DarkExt] tab state write failed', e);
    }
  }
}
