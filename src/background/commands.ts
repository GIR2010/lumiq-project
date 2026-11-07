import { resolveConfig, siteKey } from '../core/settings/resolve';
import type { SettingsStore } from './settings-store';

export function handleCommand(command: string, tab: chrome.tabs.Tab | undefined, store: SettingsStore): void {
  const { g, sites, styles } = store.snapshot();
  if (command === 'toggle-global') {
    store.updateGlobal({ def: g.def === 'on' ? 'off' : 'on' });
  } else if (command === 'toggle-site') {
    const host = tab?.url ? siteKey(tab.url) : null;
    if (!host) return;
    store.updateSite(host, { on: !resolveConfig(host, g, sites[host], styles).enabled });
  }
}
