import { useCallback, useEffect, useState } from 'react';
import { applyGlobalPatch, applySitePatch, type Patch } from '../../core/settings/patch';
import type { GlobalSettings, SiteSettings } from '../../core/settings/schema-types';
import { sendToBackground, type PopupState } from '../../shared/messages';

export type Scope = 'global' | 'site';

export function usePopupState() {
  const [state, setState] = useState<PopupState | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>('global');

  useEffect(() => {
    let alive = true;
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!alive || tab?.id === undefined) return;
      const s = await sendToBackground({ type: 'GET_TAB_STATE', tabId: tab.id });
      if (!alive) return;
      setTabId(tab.id);
      setState(s);
    })();
    return () => { alive = false; };
  }, []);

  const updateGlobal = useCallback((p: Partial<GlobalSettings>) => {
    setState((s) => s && { ...s, snapshot: { ...s.snapshot, g: applyGlobalPatch(s.snapshot.g, p) } });
    void sendToBackground({ type: 'UPDATE_GLOBAL', patch: p });
  }, []);

  const host = state?.host ?? null;
  const updateSite = useCallback((p: Patch<SiteSettings> | null) => {
    if (host === null) return;
    setState((s) => {
      if (!s) return s;
      const sites = { ...s.snapshot.sites };
      const next = p === null ? undefined : applySitePatch(sites[host], p);
      if (next) sites[host] = next; else delete sites[host];
      return { ...s, snapshot: { ...s.snapshot, sites } };
    });
    void sendToBackground({ type: 'UPDATE_SITE', host, patch: p });
  }, [host]);

  return { state, tabId, scope, setScope, updateGlobal, updateSite };
}
