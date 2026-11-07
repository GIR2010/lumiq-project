# План 1 — отложенные замечания и решения (из журнала SDD)

Сохранено из журнала выполнения плана 1 перед удалением рабочей папки. Источник для планов 2–4.

## Решения контроллера (Rulings)

- Ruling 1: T6 — colors inside a var() fallback ARE mapped; the custom-property name is never touched — the test states the intent and spec §6.1 only forbids touching variable references — if wrong, fallback colors stay unmapped (minor visual gap).
- Ruling 2: T8 extends tests/fakes/chrome.ts with tabs.get and tabs.onRemoved; T13 adds tabs.reload — fake must cover APIs the code under test calls — if wrong, only test scaffolding changes.
- Ruling 3: Execute T15 (e2e) before T14; T14 manual check is handed to the user at finish with a written checklist file — subagents cannot load an unpacked extension in the user's Chrome — cost if wrong: manual-only defects surface later, after the branch review.
- Ruling 4: Models — implementers sonnet (T2–T6 core pure modules: sonnet as mid-tier floor since plan gives prose, not full code); reviewers sonnet; final review opus.
- Task 2: Ruling: minor "l undefined for `none` channels" promoted into fix round — NaN would propagate through every downstream mapper — cost if wrong: one extra line of code
- Task 4: Ruling: malformed `s:<host>` keys from storage would make registerContentScripts reject the whole registration — Task 7 SettingsStore will drop site keys whose host != siteKey('https://'+host) — cost if wrong: one filter line
- Task 5: Ruling: dispatch clarifications — neutral tint by role color; link rule only for role text + default/neutral input; adjustments identity at defaults — spec §6.2 leaves these implicit — cost if wrong: mapping tweaks in Task 5
- Task 5: Ruling: bg lower branch becomes L_out = min(L_in, L(surface)+0.06) (spec said +0.10) so both branches meet at L_in=0.5 — spec §6.2 calls constants starting values and §10 wants monotonic darkening; an inversion across 0.5 makes slightly lighter panels darker than neighbours — cost if wrong: mid-gray backgrounds 0.04 L darker than spec's original
- Task 6: Ruling: shadow colors keep role 'shadow'; brief's test stub amended to map shadow like bg — plan test stub was inconsistent with PROPERTY_ROLES (shadow role) — cost if wrong: none (test-only)
- Task 6: Ruling: values containing color-mix( return null as a whole — required by brief null test; avoids rewriting named colors inside — cost if wrong: color-mix colors stay unmapped
- Task 7: Ruling: pending local write wins over external change for the same key (external ignored while pending; write follows) — user's latest action on this device is the intent; Chrome sync resolves cross-device last-writer anyway — cost if wrong: a concurrent remote edit within 500 ms is lost
- Task 7: Ruling: write failures are logged and lastWritten cleared, no re-queue — quota fallback and backoff are plan 4 (§4.4) — cost if wrong: a failed write is lost until next change
- Task 9: Ruling: brief assertion not.toContain('width') amended to not.toContain('width:10px') — '@media (min-width:1px)' header necessarily contains 'width' (plan defect) — cost if wrong: none
- Task 9: Ruling: parseCssText falls back to new CSSStyleSheet().replaceSync when detached <style>.sheet is null (jsdom) — real Chrome uses the detached-document path — cost if wrong: @import inside fetched CSS ignored in fallback (handled via extractImports)
- Task 9: Ruling: minor "mirror doesn't copy source media attribute" promoted into fix round — print/media-specific sheets would apply on screen — cost if wrong: one attribute copy
- Task 10: Ruling: setDisabled also temporarily restores inline styles (then re-applies) — spec §5.3 says "our styles are disabled" for detection; inline repaint would bias samples — cost if wrong: extra DOM writes during detection
- Task 10: Ruling: optional additions accepted — runChunked.syncBudgetMs (300 ms first pass) and observeRoot.onHeadChange (→ ensureBaseFirst) — backward compatible, implement plan constraints — cost if wrong: none
- Task 10: Ruling: fix both parts now — (i) count charged to first pass; (ii) cumulative build-time tracking for post-start sheets → 'heavy' past 3000 ms (no new queue) — at document_start most sheets arrive post-start, so the spec §6.6 budget would otherwise never apply — cost if wrong: small bookkeeping
- Task 10: Ruling: inline.ts "page edit makes our mapped colors the new original" (reviewer Minor 9, Task 9 code) promoted to Important in this round — detach would permanently leave dark inline colors (violates "page never half-broken") — cost if wrong: per-property original tracking
- Task 12: Ruling: controller reports 'unsupported' when GET_CONFIG returns null and subscribes to pipeline.onStatus itself — keeps index.ts thin; popup already treats unsupported — cost if wrong: badge text for null-config frames
- Task 12: Ruling: promote into fix round (a) GET_CONFIG catch-all → null (false 'unsupported', page stays light) narrowed to: connection error after retry → warn + keep placeholder until CONFIG_CHANGED? → decided: on non-invalidated failure log '[DarkExt]' and treat as null (same as now) but do NOT report 'unsupported'; (b) zod out of content.js — content bundle 316 kB parsed on every page at document_start — cost if wrong: module split only
- Task 13: Ruling: toBeInTheDocument → toBeTruthy (jest-dom not installed); src/ui/css.d.ts added for CSS imports — avoid adding a dependency for one matcher — cost if wrong: none
- Ruling: overturn Task 10 ruling (ii) — budget applies to the load window (start → first pass of sheets known at DOMContentLoaded+load, max 3000 ms); rebuilds of already-mirrored sources never count; lifetime work never trips 'heavy' — spec §6.6 describes a load budget; cumulative made long SPA sessions go 'heavy' — cost if wrong: very heavy SPAs keep processing late sheets
- Ruling: FETCH_CSS — require content-type text/css (ignoring params), 5 MB cap (Content-Length and streamed size), LRU cache of 100 entries; private/loopback blocking deferred to plan 4 (Store prep) and recorded as a Store blocker — cost if wrong: intranet CSS colours readable by malicious page until plan 4
- Ruling: I6 — content-controlled fallback style (data-darkext=fallback, html/body bg+text !important from style colors) replaces the placeholder at first evaluation and stays until sheets present at DOMContentLoaded are mirrored or failed, or 2000 ms; it is disabled together with our styles during detection — cost if wrong: brief override of site body bg on load
- Ruling: final fix wave also includes M1 (popup live status), M3 (color-scheme: dark + missing §6.4 base rules), M4, M5, M6, M7, M9 — cheap correctness/UX items the reviewer flagged; M2, M8, M10–M13 parked
- Ruling: accepted fix-wave decisions — pipeline.adoptedChanged(root?), freeze() removes fallback, detached shadow hosts pruned and not re-watched, never-loading <link> keeps load window open, per-frame config batching (hidden tabs apply on visibility) — consistent with spec; cost if wrong: re-attached shadow hosts stay light until next config change

## Отложенные замечания (Minor / parked)

- Task 1: minor (deferred): toolchain is bleeding-edge majors (vite 8, vitest 5, TS 7, zod 4, @types/chrome 0.3) with carets — pin/document
- Task 1: minor (deferred): package.json version 1.0.0 vs manifest 0.1.0
- Task 1: minor (deferred): `npm run dev` watch mode — popup emptyOutDir:true may wipe lib outputs on rebuild (unverified)
- Task 1: minor (deferred): i18n.test.ts leaks globalThis.chrome, uses `as any`
- Task 2: minor (deferred): contrastRatio throws on unparseable strings (undocumented); alpha not clamped in formatColor; thin coverage (gamut clamp, hue 0, alpha boundary)
- Task 2: minor (deferred): 8-bit rounding duplicated between formatColor and toCuloriInput
- Task 3: minor (deferred): interfaces not tied to zod schemas (no satisfies/infer check)
- Task 3: minor (deferred): applyGlobalPatch lets explicit undefined overwrite; empty adj patch leaves {adj:{}}
- Task 3: minor (deferred): DEFAULT_GLOBAL.adj aliases DEFAULT_ADJUSTMENTS; preset colors mutable shared refs
- Task 3: minor (deferred): no StyleColorsSchema check over presets; thin schema boundary tests
- Task 4: minor (deferred): colors/overrides returned by reference from resolveConfig; test gaps (non-mutation assert, siteKey edge cases, def:on empty sites)
- Task 5: minor (deferred): shadow test doesn't assert L; default-link check ignores hue; memo Map unbounded; parseColor(colors.bg)! assertion
- Task 5: fix round 1 implementer DONE (f47ade2); minor (deferred): CRLF→LF warnings — consider .gitattributes
- Task 5: minor (deferred): continuity relies on surface.l+0.06 ≤ 0.5 — light custom surfaces could reintroduce jump; clamp cap to bgLow
- Task 6: minor (deferred): commit trailers mix "Claude Opus 5.5"/"Claude Sonnet 5.5" (subagent attribution) — cosmetic
- Task 6: minor (deferred): roleOf uses prototype lookup (constructor); isLinkSelector naive split ([attr="x y"], :is(h1, a)); detect boundary/NaN untested; missing tests for var fallback forms, !important, text-shadow/fill/stroke, base rules beyond html/body
- Task 6: minor (deferred): urlRe rescanned per loop (O(n²) on long values)
- Task 7: minor (deferred): updateSite doesn't normalize host; no-op updates still schedule/emit; styles non-array silently []; same() via JSON.stringify
- Task 8: minor (deferred): registration compare ignores runAt/allFrames/persist and array order; css-fetch no size/cache bound; FETCH_CSS can reach localhost/LAN (only colors leak to page via mirrors — low risk; consider blocking private ranges before Store); failed tabs.get → 'unsupported'; REPORT_STATE unvalidated; `as any` in tests; no onRemoved/index wiring tests
- Task 8: minor (deferred): restart-update test now emits a console.warn (fake has no seeded script) — test output not pristine; seed fake state
- Task 9: minor (deferred): CSS nesting (rules nested inside style rules) not mirrored; @supports/@layer/@container only e2e-covered
- Task 9: minor (deferred): ruleHeader via cssText (quadratic, '{' in strings) instead of conditionText/name/mediaText; @page emitted; replaceSync unconditional would be simpler; non-Security errors → 'pending'; touched set strong refs; instanceof Element cross-realm; clear() keeps disabled; test gaps (adopted, removeMirror, escaped selectors, @layer/@supports)
- Task 9: minor (deferred): InlineStyler `restored` Map holds strong refs
- Task 10: minor (deferred): cross-origin @import inside same-origin sheet skipped; late @import in <style> not rebuilt; sheet.disabled toggles not observed; no pipeline-level 'heavy' test; pipeline.ts ~460 lines
- Task 10: minor (deferred): cross-origin @import media/supports/layer conditions dropped; moved <style> fully rebuilt each time (possible per-frame ping-pong); setDisabled(false) re-applies all inline synchronously; pipeline.ts could split remote-css loader; own adopted detection via diff; removed shadow hosts kept until next start; fetch failures silent (add console.debug)
- Task 10: minor (deferred): no test for budget reset on start after detach; restore re-serializes colors (#000→rgb) when page edited element
- Task 11: minor (deferred): adoptedStyleSheets in-place push/splice (ObservableArray) undetected — plan-mandated gap, check in e2e; CSSGroupingRule insert/deleteRule not hooked; wrappers constructible (have prototype); __darkextHooked configurable
- Task 11: minor (deferred): replace test re-imports hook → double wrappers for later tests in file
- Task 12: minor (deferred): stop() leaves inert listeners; pipeline observers keep running after die(); detectOnce duplication; WeakRef shadow root dedupe; detector.ts untested; controller tests for detect-throws / start-before-placeholder order / onConfig after stop
- Task 12: minor (deferred): build.test zod check depends on earlier test having built dist
- Task 13: minor (deferred): void sendToBackground unhandled/no rollback; missing tests ({on:null},{on:true}, retry, two sliders); deleted user style shows first option; reset button always shown
- Task 13: minor (deferred): popup retry timer not cleared on unmount; blank during manual retry
- Task 15: minor (deferred): setSettings fixed 600 ms vs registration timing; context fixture doesn't await SW readiness; tabStatus couples to session key layout; SW shutdown 'tab state cleanup failed' warn noise
- Ruling: final fix wave also includes M1 (popup live status), M3 (color-scheme: dark + missing §6.4 base rules), M4, M5, M6, M7, M9 — cheap correctness/UX items the reviewer flagged; M2, M8, M10–M13 parked
- Final review: parked — M2 @keyframes colours not mirrored — Ruling: real, deferred to plan 2 backlog (visual only)
- Final review: parked — M8 Web Store/PDF not 'unsupported', TabState not cleared on navigation — Ruling: real, deferred to plan 4 (popup polish)
- Final review: parked — M10 strong refs to removed elements/roots on long SPAs — Ruling: real, deferred (memory only, no visible effect)
- Final review: parked — M11 one invalid match pattern fails whole registration — Ruling: real; siteKey already filters keys; deferred
- Final review: parked — M12 verify tabs.sendMessage 'port closed' warnings — Ruling: verify in T14 manual run
- Final review: parked — M13 var() shorthands possibly empty longhands in Chrome CSSOM — Ruling: verify in T14 manual run (GitHub)
- Final review: minor (deferred): pipeline.ts now 728 lines — split load-window/fallback progress tracking into its own module (next plan)
- Final review: parked — controller test «report только при изменении» now vacuous (no frame await) — Ruling: real, test-only; deferred to plan 2 cleanup
- Final review: parked — SW may remember older config if sends settle out of order — Ruling: real but unlikely (in-order listener); deferred, per-tab sequence later
- Final review: parked — frame whose GET_CONFIG never reached SW recovers only on config change — Ruling: acceptable (rare)
- Final review: parked — attachRoot rebuild of shared adopted sheet charged in load window — Ruling: cannot drop built sources; acceptable
