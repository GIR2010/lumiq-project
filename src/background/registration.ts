import type { Registration } from '../core/settings/registration';

const ID = 'darkext-placeholder';

// undefined = unknown in this worker lifetime; null = known to be unregistered.
let last: Registration | null | undefined;

export function resetRegistrationCache(): void { last = undefined; }

const same = (a: Registration, b: Registration) =>
  a.file === b.file
  && JSON.stringify(a.matches) === JSON.stringify(b.matches)
  && JSON.stringify(a.excludeMatches) === JSON.stringify(b.excludeMatches);

const toScript = (r: Registration): chrome.scripting.RegisteredContentScript => ({
  id: ID, js: [r.file], matches: r.matches, excludeMatches: r.excludeMatches,
  runAt: 'document_start', allFrames: false, persistAcrossSessions: true,
});

const fromScript = (s: chrome.scripting.RegisteredContentScript): Registration => ({
  file: (s.js?.[0] ?? '') as Registration['file'],
  matches: s.matches ?? [], excludeMatches: s.excludeMatches ?? [],
});

export async function syncRegistration(reg: Registration | null): Promise<void> {
  try {
    if (last === undefined) {
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [ID] });
      last = existing.length ? fromScript(existing[0]) : null;
    }
    if (last === null && reg === null) return;
    if (last !== null && reg !== null && same(last, reg)) return;
    if (reg === null) await chrome.scripting.unregisterContentScripts({ ids: [ID] });
    else if (last === null) await chrome.scripting.registerContentScripts([toScript(reg)]);
    else await chrome.scripting.updateContentScripts([toScript(reg)]);
    last = reg;
  } catch (e) {
    last = undefined; // state unknown after a failure: re-read next time
    console.warn('[DarkExt] placeholder registration failed', e);
  }
}
