import type { TabStatus } from '../shared/messages';

const TEXT: Record<TabStatus, string> = {
  active: '', unsupported: '', off: 'off', 'system-light': 'off',
  'already-dark': 'auto', error: '!', heavy: '~',
};

export async function setBadge(tabId: number, status: TabStatus): Promise<void> {
  try {
    await chrome.action.setBadgeText({ tabId, text: TEXT[status] });
    if (status === 'error') await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
  } catch (e) {
    console.warn('[DarkExt] badge update failed', e);
  }
}
