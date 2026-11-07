import { computeRegistration } from '../core/settings/registration';
import type { Request } from '../shared/messages';
import { handleCommand } from './commands';
import { syncRegistration } from './registration';
import { broadcast, createRouter } from './router';
import { SentConfigs } from './sent-configs';
import { SettingsStore } from './settings-store';
import { TabStateStore } from './tab-state';

const store = new SettingsStore();
const sent = new SentConfigs();
const route = createRouter(store, new TabStateStore(), sent);

const syncRegistrationFromStore = () => {
  const { g, sites } = store.snapshot();
  return syncRegistration(computeRegistration(g, sites));
};

// Listeners are registered synchronously at top level (MV3 requirement).
store.onChange(() => {
  void broadcast(store, sent);
  void syncRegistrationFromStore();
});

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
  store.ready
    .then(() => route(msg, sender))
    .then(sendResponse, (e: unknown) => {
      console.warn('[DarkExt] message failed', e);
      sendResponse(undefined);
    });
  return true;
});

chrome.commands.onCommand.addListener((command, tab) => {
  void store.ready.then(() => handleCommand(command, tab, store));
});

void store.ready.then(syncRegistrationFromStore);
