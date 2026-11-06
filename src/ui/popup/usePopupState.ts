import { useCallback, useEffect, useState } from 'react';
import { applyGlobalPatch, applySitePatch, type Patch } from '../../core/settings/patch';
import type { GlobalSettings, SiteSettings } from '../../core/settings/schema-types';
import { sendToBackground, type PopupState } from '../../shared/messages';

export type Scope = 'global' | 'site';

const warnSend = (e: unknown) => console.warn('[DarkExt] update failed', e);

export function usePopupState() {
  const [state, setState] = useState<PopupState | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>('global');

  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('no active tab id');
      const s = await sendToBackground({ type: 'GET_TAB_STATE', tabId: tab.id });
      if (!s) throw new Error('empty GET_TAB_STATE response');
      return { id: tab.id, s };
    };
    (async () => {
      let res: Awaited<ReturnType<typeof load>> | undefined;
      for (let i = 0; i < 2 && !res; i++) {
        try { res = await load(); } catch (e) {
          if (i === 0) await new Promise((r) => setTimeout(r, 150));
          else console.warn('[DarkExt] failed to load popup state', e);
        }
        if (!alive) return;
      }
      if (!res) { setFailed(true); return; }
      setFailed(false);
      setTabId(res.id);
      setState(res.s);
    })();
    return () => { alive = false; };
  }, [attempt]);

  const retryLoad = useCallback(() => { setFailed(false); setAttempt((n) => n + 1); }, []);

  const updateGlobal = useCallback((p: Partial<GlobalSettings>) => {
    setState((s) => s && { ...s, snapshot: { ...s.snapshot, g: applyGlobalPatch(s.snapshot.g, p) } });
    sendToBackground({ type: 'UPDATE_GLOBAL', patch: p }).catch(warnSend);
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
    sendToBackground({ type: 'UPDATE_SITE', host, patch: p }).catch(warnSend);
  }, [host]);

  return { state, failed, retryLoad, tabId, scope, setScope, updateGlobal, updateSite };
}
