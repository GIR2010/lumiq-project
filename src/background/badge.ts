import type { TabStatus } from '../shared/messages';

const TEXT: Record<TabStatus, string> = {
  active: '', unsupported: '', off: 'off', 'system-light': 'off',
  'already-dark': 'auto', error: '!', heavy: '~',
};
const ERROR_BG = '#d93025';

export async function setBadge(tabId: number, status: TabStatus): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: TEXT[status] });
    // Non-error statuses get the default colour back (the tab may have shown an error before).
    const color = status === 'error' ? ERROR_BG : await chrome.action.getBadgeBackgroundColor({});
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch (e) {
    console.warn('[DarkExt] badge update failed', e);
  }
}
