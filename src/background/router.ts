import { resolveConfig, siteKey, type EffectiveConfig } from '../core/settings/resolve';
import type { ContentMessage, PopupState, Request, TabState } from '../shared/messages';
import { setBadge } from './badge';
import { fetchCss } from './css-fetch';
import type { SettingsStore } from './settings-store';
import type { TabStateStore } from './tab-state';

const NO_RECEIVER = /Could not establish connection|Receiving end does not exist/i;

function configFor(store: SettingsStore, url: string | undefined): EffectiveConfig | null {
  const host = url ? siteKey(url) : null;
  if (!host) return null;
  const { g, sites, styles } = store.snapshot();
  return resolveConfig(host, g, sites[host], styles);
}

export function createRouter(store: SettingsStore, tabs: TabStateStore) {
  return async (msg: Request, sender: chrome.runtime.MessageSender): Promise<unknown> => {
    switch (msg.type) {
      case 'GET_CONFIG':
        return configFor(store, sender.tab?.url);
      case 'FETCH_CSS':
        try { return { text: await fetchCss(msg.url) }; }
        catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
      case 'REPORT_STATE': {
        const id = sender.tab?.id;
        if (sender.frameId !== 0 || id === undefined) return;
        await tabs.set(id, msg.state);
        await setBadge(id, msg.state.status);
        return;
      }
      case 'GET_TAB_STATE': {
        let url: string | undefined;
        try { url = (await chrome.tabs.get(msg.tabId)).url; }
        catch (e) { console.warn('[DarkExt] tabs.get failed', e); }
        const host = url ? siteKey(url) : null;
        const state: TabState = host === null
          ? { status: 'unsupported', detectedDark: false }
          : (await tabs.get(msg.tabId)) ?? { status: 'off', detectedDark: false };
        const popup: PopupState = { host, state, snapshot: store.snapshot() };
        return popup;
      }
      case 'UPDATE_GLOBAL':
        store.updateGlobal(msg.patch);
        return;
      case 'UPDATE_SITE':
        store.updateSite(msg.host, msg.patch);
        return;
    }
  };
}

export async function broadcast(store: SettingsStore): Promise<void> {
  let list: chrome.tabs.Tab[];
  try { list = await chrome.tabs.query({}); }
  catch (e) { console.warn('[DarkExt] tabs.query failed', e); return; }
  await Promise.all(list.map(async (tab) => {
    if (tab.id === undefined) return;
    const config = configFor(store, tab.url);
    if (!config) return;
    const msg: ContentMessage = { type: 'CONFIG_CHANGED', config };
    try { await chrome.tabs.sendMessage(tab.id, msg); }
    catch (e) {
      if (!NO_RECEIVER.test(e instanceof Error ? e.message : String(e))) console.warn('[DarkExt] broadcast failed', tab.id, e);
    }
  }));
}
