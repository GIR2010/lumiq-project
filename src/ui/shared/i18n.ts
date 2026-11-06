import type en from '../../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof en;

export function t(key: MessageKey, ...subs: string[]): string {
  return chrome.i18n.getMessage(key, subs) || key;
}
