import type { EffectiveConfig, ApplyStatus } from '../core/settings/resolve';
import type { GlobalSettings, SiteSettings, UserStyle } from '../core/settings/schema-types';
import type { Patch } from '../core/settings/patch';

export type TabStatus = ApplyStatus | 'error' | 'heavy' | 'unsupported';
export interface TabState { status: TabStatus; detectedDark: boolean }
export interface Snapshot { g: GlobalSettings; styles: UserStyle[]; sites: Record<string, SiteSettings> }
export interface PopupState { host: string | null; state: TabState; snapshot: Snapshot }

export type Request =
  | { type: 'GET_CONFIG' }
  | { type: 'FETCH_CSS'; url: string }
  | { type: 'REPORT_STATE'; state: TabState }
  | { type: 'GET_TAB_STATE'; tabId: number }
  | { type: 'UPDATE_GLOBAL'; patch: Partial<GlobalSettings> }
  | { type: 'UPDATE_SITE'; host: string; patch: Patch<SiteSettings> | null };

export type ContentMessage = { type: 'CONFIG_CHANGED'; config: EffectiveConfig | null };

export type ResponseOf<R extends Request> =
  R extends { type: 'GET_CONFIG' } ? EffectiveConfig | null
  : R extends { type: 'FETCH_CSS' } ? { text: string } | { error: string }
  : R extends { type: 'GET_TAB_STATE' } ? PopupState
  : void;

export function sendToBackground<R extends Request>(msg: R): Promise<ResponseOf<R>> {
  return chrome.runtime.sendMessage(msg) as Promise<ResponseOf<R>>;
}
