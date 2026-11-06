# План 1: ядро и режим «Адаптивный» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Рабочее MV3-расширение, которое затемняет сайты в режиме «Адаптивный», с глобальным/посайтовым включением, автоопределением тёмных сайтов, следованием системной теме, синхронизацией настроек, горячими клавишами `toggle-site`/`toggle-global` и минимальным popup.

**Architecture:** Чистое ядро (`src/core`: цвета, стратегия сопоставления, настройки, CSS-преобразования) + service worker как единственный владелец хранилища и хаб сообщений + content script с единым конвейером «сбор → `ColorMapper` → зеркальные стили → наблюдатель» + main-world hook для shadow DOM и CSS-in-JS + popup на React.

**Tech Stack:** TypeScript (strict), Vite (программная сборка, без CRXJS), React 18, zod, culori, Vitest + jsdom, React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-dark-mode-extension-design.md`

### Дорожная карта (план 1 из 4)

| План | Содержание | Разделы спецификации |
|---|---|---|
| **1 (этот)** | ядро, режим «Адаптивный», service worker, content pipeline, детектор, заглушка, popup (без режима и правок), 2 горячие клавиши, e2e-каркас | §2, §3, §4.1–4.3, debounce из §4.4, §5, §6 кроме §6.3, §7 (относящиеся строки), §9.1 частично, §10 частично |
| 2 | режим «Свой стиль» (`StyleMapper`, анализ, защита контраста, `keepBgImages`), переключатель режима в popup, `toggle-mode` | §6.3, §5.6 |
| 3 | выбор элемента и правки (`selector`, слой правок, picker, `PREVIEW`, список правок в popup), `start-picker` | §8 |
| 4 | страница настроек, редактор стилей и быстрый редактор в popup, импорт/экспорт, квоты и `local`-фолбэк, миграции, иконки, подготовка к Store | §4.4–4.6, §9.1 п.5/п.8, §9.2 |

## Global Constraints

- Manifest V3. Разрешения ровно: `storage`, `scripting`; `host_permissions: ["<all_urls>"]`. Разрешение `tabs` не запрашивается.
- Никаких сетевых запросов, кроме загрузки CSS-файлов посещаемых сайтов (`FETCH_CSS`); никакой телеметрии, никаких внешних CDN.
- TypeScript `strict: true`; React 18; content/main-world/placeholder собираются как IIFE; service worker — ES-модуль (`"type": "module"`).
- Все строки UI — через `t(key)` поверх `chrome.i18n.getMessage`; локали `ru` и `en`, `default_locale: "en"`; наборы ключей в двух локалях совпадают.
- Префикс логов: `[DarkExt]`. Все наши DOM-элементы помечены `data-darkext="<placeholder|base|mirror>"`.
- Ключи `chrome.storage.sync`: `g`, `styles`, `s:<host>`; `SCHEMA_VERSION = 1`.
- Ключ сайта: `hostname` в нижнем регистре без ведущего `www.`; только `http:`/`https:`.
- Запись настроек в хранилище — с debounce **500 мс** по ключу; изменения применяются на вкладках сразу из памяти.
- Бюджеты конвейера: первый синхронный проход — листы в `<head>`; общий бюджет **3000 мс**; первый проход ограничен **300 мс** / **50 000** правил.
- Детектор: тёмная, если средняя OKLCH-светлота 9 точек `L < 0.4`; «неуверенно» при `0.4 ≤ L < 0.6`.
- Горячие клавиши: `toggle-site` = `Alt+Shift+D`, `toggle-global` = `Alt+Shift+G`.
- Значения по умолчанию: `def: 'on'`, `sys: false`, `eng: 'adaptive'`, `st: 'graphite'`, `adj = {br:100, ct:100, sp:0, gs:0, img:0}`, `keepBgImages: true`.

## Review Focus

1. **CSS-in-JS через `insertRule`** (styled-components, emotion в production) — правила добавляются без DOM-мутаций; ожидается, что новые правила тоже становятся тёмными. → тест в Task 11 (hook шлёт `darkext:sheet-changed`) и e2e в Task 15 (`css-in-js.html`).
2. **Многократное вкл/выкл на одной странице** (горячая клавиша, popup) — ожидается ровно один набор наших `<style>`, атрибуты `style` восстановлены побайтно. → тест в Task 9 `start → detach → start → detach`.
3. **`document_start` без `<head>`** и `<link rel=stylesheet>`, ещё не загруженный в момент сбора (`cssRules` бросает или `null`) — ожидается, что стили применятся, когда появятся. → тесты в Task 9 (нет `head`) и Task 10 (лист `pending` → обработка по событию `load`).
4. **Нестандартные значения цвета**: `transparent`, `currentColor`, `inherit`, `var(--x)`, системные `Canvas`/`CanvasText`, `color-mix()`, альфа — ожидается, что они не трогаются или корректно преобразуются, а результат — всегда валидный CSS. → тест в Task 6.
5. **Быстрая серия изменений** (перетаскивание ползунка) — ожидается одна запись в хранилище с последним значением и рассылка на вкладки каждого изменения. → тест в Task 7.

---

## Структура файлов

```
package.json, tsconfig.json, vitest.config.ts, playwright.config.ts
scripts/build.ts                         — программная сборка всех входов Vite
public/manifest.json
public/_locales/{en,ru}/messages.json
src/core/color/index.ts                  — Oklch, parseColor, formatColor, contrastRatio, isNeutral
src/core/settings/schema.ts              — zod-схемы и типы настроек
src/core/settings/defaults.ts            — DEFAULT_GLOBAL, DEFAULT_ADJUSTMENTS
src/core/settings/presets.ts             — 5 встроенных стилей, findStyle
src/core/settings/patch.ts               — применение патчей к глобальным/сайтовым настройкам
src/core/settings/resolve.ts             — siteKey, resolveConfig, shouldApply
src/core/settings/registration.ts        — computeRegistration (заглушка)
src/core/mapping/types.ts                — Role, RuleContext, ColorMapper, PageColorStats, ColorFn
src/core/mapping/adaptive.ts             — createAdaptiveMapper
src/core/mapping/adjust.ts               — applyAdjustments
src/core/mapping/color-fn.ts             — createColorFn (мемоизация + ползунки + формат)
src/core/css/declarations.ts             — PROPERTY_ROLES, roleOf, mapDeclarationValue, isLinkSelector
src/core/css/vars.ts                     — VarRoleCounter
src/core/css/base.ts                     — buildBaseCss
src/core/detect.ts                       — classifyDarkness
src/shared/messages.ts                   — типы сообщений, sendToBackground
src/background/settings-store.ts         — SettingsStore (кэш, debounce, внешние изменения)
src/background/tab-state.ts              — TabStateStore (chrome.storage.session)
src/background/registration.ts           — syncRegistration
src/background/css-fetch.ts              — fetchCss
src/background/badge.ts                  — setBadge
src/background/commands.ts               — handleCommand
src/background/router.ts                 — обработчик сообщений
src/background/index.ts                  — связывание
src/content/pipeline/sheets.ts           — readRules, parseCssText, extractImports
src/content/pipeline/mirror.ts           — countVarUsage, buildMirrorCss
src/content/pipeline/writer.ts           — StyleWriter
src/content/pipeline/inline.ts           — InlineStyler
src/content/pipeline/scheduler.ts        — runChunked
src/content/pipeline/observer.ts         — observeRoot
src/content/pipeline/pipeline.ts         — createPipeline
src/content/detector.ts                  — sampleBackgrounds, readSchemeSignals
src/content/index.ts                     — точка входа content script
src/main-world/hook.ts                   — перехват attachShadow / adoptedStyleSheets / insertRule
src/placeholder/placeholder.ts           — заглушка (собирается в 2 варианта)
src/ui/shared/i18n.ts, src/ui/shared/components/*.tsx
src/ui/popup/{index.html, main.tsx, App.tsx, usePopupState.ts, popup.css}
tests/fakes/chrome.ts                    — поддельный chrome.* для модульных тестов
tests/e2e/{server.ts, fixtures/*, *.spec.ts}
```

Модульные тесты лежат рядом с кодом: `foo.ts` → `foo.test.ts`.

---

### Task 1: Каркас проекта, сборка, манифест, i18n

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `scripts/build.ts`, `public/manifest.json`, `public/_locales/en/messages.json`, `public/_locales/ru/messages.json`, `src/ui/shared/i18n.ts`, `src/ui/shared/i18n.test.ts`, `scripts/build.test.ts`
- Create (временные заглушки входов, заполняются в следующих задачах): `src/background/index.ts`, `src/content/index.ts`, `src/main-world/hook.ts`, `src/placeholder/placeholder.ts`, `src/ui/popup/index.html`, `src/ui/popup/main.tsx`

**Interfaces:**
- Produces: `t(key: MessageKey, ...subs: string[]): string`; `type MessageKey = keyof typeof import('../../../public/_locales/en/messages.json')`; команды npm `build`, `dev`, `test`, `typecheck`, `test:e2e`; структура `dist/`: `manifest.json`, `background.js`, `content.js`, `main-world.js`, `placeholder.js`, `placeholder-sys.js`, `popup/index.html`, `_locales/**`.

- [ ] **Step 1: Инициализировать npm и зависимости**

```bash
npm init -y
npm i react@18 react-dom@18 zod culori
npm i -D typescript vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/user-event @types/react@18 @types/react-dom@18 @types/chrome @types/culori @types/node tsx @playwright/test
```

`package.json` scripts: `"build": "tsx scripts/build.ts"`, `"dev": "tsx scripts/build.ts --watch"`, `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`, `"test:e2e": "npm run build && playwright test"`. `"type": "module"`.

`tsconfig.json`: `strict`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`, `resolveJsonModule`, `types: ["chrome", "vitest/globals", "node"]`, `include: ["src", "tests", "scripts"]`.

`vitest.config.ts`: `environment: 'node'` по умолчанию (DOM-тесты включают jsdom комментарием `// @vitest-environment jsdom`), `globals: true`, `include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts']`.

`.gitignore`: `node_modules/`, `dist/`, `test-results/`, `playwright-report/`.

- [ ] **Step 2: Написать падающие тесты i18n и сборки**

```ts
// src/ui/shared/i18n.test.ts
import en from '../../../public/_locales/en/messages.json';
import ru from '../../../public/_locales/ru/messages.json';
import { t } from './i18n';

test('ru и en содержат одинаковые ключи', () => {
  expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
});
test('каждое сообщение имеет непустой message', () => {
  for (const m of [...Object.values(en), ...Object.values(ru)]) expect(m.message.length).toBeGreaterThan(0);
});
test('t делегирует chrome.i18n.getMessage и возвращает ключ при пустом ответе', () => {
  (globalThis as any).chrome = { i18n: { getMessage: (k: string) => (k === 'statusActive' ? 'Активно' : '') } };
  expect(t('statusActive')).toBe('Активно');
  expect(t('statusOff')).toBe('statusOff');
});
```

```ts
// scripts/build.test.ts  — запускает сборку и проверяет dist
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
test('сборка создаёт все входы манифеста', () => {
  execSync('npm run build', { stdio: 'inherit' });
  const m = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  for (const f of ['background.js', 'content.js', 'main-world.js', 'placeholder.js', 'placeholder-sys.js', 'popup/index.html', '_locales/ru/messages.json'])
    expect(existsSync(`dist/${f}`)).toBe(true);
  expect(m.permissions).toEqual(['storage', 'scripting']);
  expect(m.host_permissions).toEqual(['<all_urls>']);
  expect(readFileSync('dist/content.js', 'utf8')).not.toMatch(/^\s*import\s/m); // IIFE, без ESM
}, 120_000);
```

- [ ] **Step 3: Запустить тесты, убедиться что падают**

Run: `npx vitest run src/ui/shared/i18n.test.ts scripts/build.test.ts`
Expected: FAIL (нет файлов локалей, `./i18n`, скрипта сборки).

- [ ] **Step 4: Создать манифест, локали, `t()` и `scripts/build.ts`**

`public/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "__MSG_extName__",
  "description": "__MSG_extDescription__",
  "version": "0.1.0",
  "default_locale": "en",
  "permissions": ["storage", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup/index.html" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["main-world.js"], "run_at": "document_start", "all_frames": true, "match_about_blank": true, "world": "MAIN" },
    { "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_start", "all_frames": true, "match_about_blank": true }
  ],
  "commands": {
    "toggle-site":   { "suggested_key": { "default": "Alt+Shift+D" }, "description": "__MSG_cmdToggleSite__" },
    "toggle-global": { "suggested_key": { "default": "Alt+Shift+G" }, "description": "__MSG_cmdToggleGlobal__" }
  }
}
```

Ключи локалей (формат Chrome `{ "key": { "message": "..." } }`) — ровно эти:

| Ключ | en | ru |
|---|---|---|
| `extName` | DarkExt | DarkExt |
| `extDescription` | Dark mode for any site, tuned to your colors | Тёмный режим для любого сайта в ваших цветах |
| `cmdToggleSite` | Toggle dark mode on this site | Вкл/выкл тёмный режим на этом сайте |
| `cmdToggleGlobal` | Toggle default: on everywhere / off everywhere | Переключить: включено везде / выключено везде |
| `statusActive` | Active | Активно |
| `statusOff` | Off | Выключено |
| `statusSystemLight` | Off — system theme is light | Выключено — светлая тема системы |
| `statusAlreadyDark` | Site is already dark | Сайт уже тёмный |
| `statusError` | Error on this page | Ошибка на этой странице |
| `statusHeavy` | Page is too heavy, some styles skipped | Страница слишком тяжёлая, часть стилей не обработана |
| `statusUnsupported` | Not available on this page | На этой странице недоступно |
| `siteToggleLabel` | On this site | На этом сайте |
| `siteDefault` | Default | По умолчанию |
| `siteOn` | On | Вкл |
| `siteOff` | Off | Выкл |
| `alreadyDarkBanner` | Site is already dark — not darkening | Сайт уже тёмный — не затемняю |
| `forceDarken` | Darken anyway | Всё равно затемнить |
| `scopeGlobal` | Global | Глобально |
| `scopeSite` | This site | Этот сайт |
| `resetToGlobal` | Reset to global | Сбросить к глобальным |
| `styleLabel` | Style | Стиль |
| `sliderBrightness` | Brightness | Яркость |
| `sliderContrast` | Contrast | Контраст |
| `sliderSepia` | Sepia | Сепия |
| `sliderGrayscale` | Grayscale | Оттенки серого |
| `sliderImages` | Dim images | Приглушить изображения |
| `globalOn` | On everywhere | Включено везде |
| `globalOff` | Off everywhere | Выключено везде |
| `retry` | Restart | Перезапустить |
| `preset_graphite` | Graphite | Графит |
| `preset_midnight` | Deep night | Глубокая ночь |
| `preset_oled` | OLED | OLED |
| `preset_warm` | Warm | Тёплый |
| `preset_contrast` | High contrast | Высокий контраст |

`t()`: `chrome.i18n.getMessage(key, subs) || key`.

`scripts/build.ts`: вызывает `vite.build()` последовательно:
1. popup — `root: 'src/ui'`, `input: { popup: 'src/ui/popup/index.html' }`, `outDir: '../../dist'`, `emptyOutDir: true`, `publicDir: '../../public'` (копирует манифест и локали), плагин React;
2. `background` — `build.lib`, `formats: ['es']`, `fileName: () => 'background.js'`;
3. `content`, `main-world` — `build.lib`, `formats: ['iife']`, `name: 'DarkExt<Name>'`;
4. `placeholder` дважды из `src/placeholder/placeholder.ts` с `define: { __SYS__: 'false' | 'true' }` → `placeholder.js` / `placeholder-sys.js`.

Сборки 2–4: `emptyOutDir: false`, `publicDir: false`, `minify: false` для читаемости при отладке. Флаг `--watch` передаёт `build.watch: {}` всем.

Входы-заглушки: в каждом `src/.../index.ts` — `export {}`; `popup/index.html` с `<div id="root">` и `<script type="module" src="./main.tsx">`; `main.tsx` рендерит `null`.

- [ ] **Step 5: Запустить тесты, убедиться что проходят**

Run: `npx vitest run src/ui/shared/i18n.test.ts scripts/build.test.ts && npm run typecheck`
Expected: PASS, `tsc` без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add -A && git commit -m "chore: scaffold extension build, manifest and i18n"
```

---

### Task 2: Цветовая математика (`core/color`)

**Files:**
- Create: `src/core/color/index.ts`, `src/core/color/index.test.ts`

**Interfaces:**
- Produces:
  - `type Oklch = { l: number; c: number; h: number; alpha: number }` — `l` 0..1, `h` градусы 0..360 (для ахроматических `0`), `alpha` 0..1.
  - `parseColor(input: string): Oklch | null` — `null` для не-цвета, `transparent`, `currentColor`, `inherit`/`initial`/`unset`/`revert`, `var(...)`, системных цветов (`Canvas`, `CanvasText`, `LinkText`, `ButtonFace` и др.), `color-mix(...)`.
  - `formatColor(c: Oklch): string` — `#rrggbb` при `alpha === 1`, иначе `rgba(r, g, b, a)` (a с 3 знаками); перед форматом — `clampChroma` в sRGB.
  - `contrastRatio(a: Oklch | string, b: Oklch | string): number` — WCAG 2.x.
  - `isNeutral(c: Oklch, threshold = 0.02): boolean`.

- [ ] **Step 1: Написать падающие тесты**

```ts
import { parseColor, formatColor, contrastRatio, isNeutral } from './index';

test.each(['#fff', '#ffffff', 'white', 'rgb(255 255 255)', 'rgba(255,255,255,1)', 'hsl(0 0% 100%)'])
  ('%s → белый', s => { const c = parseColor(s)!; expect(c.l).toBeCloseTo(1, 2); expect(c.alpha).toBe(1); });
test('альфа сохраняется', () => expect(parseColor('rgba(0,0,0,.5)')!.alpha).toBeCloseTo(0.5));
test.each(['transparent', 'currentColor', 'inherit', 'var(--x)', 'Canvas', 'CanvasText', 'color-mix(in srgb, red, blue)', 'solid', '10px', ''])
  ('%s → null', s => expect(parseColor(s)).toBeNull());
test('туда-обратно', () => {
  for (const hex of ['#1e1f22', '#6ea8fe', '#f2706b', '#000000', '#ffffff']) expect(formatColor(parseColor(hex)!)).toBe(hex);
});
test('формат с альфой', () => expect(formatColor({ ...parseColor('#000')!, alpha: 0.25 })).toBe('rgba(0, 0, 0, 0.250)'));
test('контраст', () => {
  expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 0);
  expect(contrastRatio('#777', '#fff')).toBeCloseTo(4.48, 1);
});
test('нейтральность', () => { expect(isNeutral(parseColor('#808080')!)).toBe(true); expect(isNeutral(parseColor('#3366ff')!)).toBe(false); });
```

- [ ] **Step 2: Run** `npx vitest run src/core/color` — Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализовать в `src/core/color/index.ts`** на `culori` (`parse`, `converter('oklch')`, `formatHex`, `formatRgb`, `clampChroma`, `wcagContrast`). Отсечение ключевых слов и функций (`var(`, `color-mix(`, системные цвета — список из CSS Color 4) — до вызова `parse`. `NaN` hue → `0`.

- [ ] **Step 4: Run** `npx vitest run src/core/color` — Expected: PASS.

- [ ] **Step 5: Коммит** `git add src/core/color && git commit -m "feat(core): color parsing and OKLCH math"`

---

### Task 3: Схема настроек, умолчания, встроенные стили, патчи

**Files:**
- Create: `src/core/settings/schema.ts`, `defaults.ts`, `presets.ts`, `patch.ts` и тесты `presets.test.ts`, `patch.test.ts`, `schema.test.ts`

**Interfaces:**
- Consumes: `contrastRatio` (Task 2).
- Produces:
  - `STYLE_KEYS = ['bg','surface','elevated','text','textMuted','onAccent','link','linkVisited','border','accent','success','warning','danger','selection'] as const`; `type StyleKey`; `type StyleColors = Record<StyleKey, string>`.
  - `type Engine = 'adaptive' | 'style'`.
  - `interface Adjustments { br: number; ct: number; sp: number; gs: number; img: number }` (диапазоны §4.3: br/ct 50..150, sp/gs 0..100, img 0..30).
  - `interface GlobalSettings { v: number; def: 'on'|'off'; sys: boolean; eng: Engine; st: string; adj: Adjustments; keepBgImages: boolean }`.
  - `interface UserStyle { id: string; name: string; c: StyleColors }`.
  - `type OverrideRule = [string, string|null, string|null, string|null, number]`.
  - `interface SiteSettings { on?: boolean; eng?: Engine; st?: string; adj?: Partial<Adjustments>; det?: true; r?: OverrideRule[] }`.
  - zod: `StyleColorsSchema`, `AdjustmentsSchema`, `GlobalSettingsSchema`, `SiteSettingsSchema`, `UserStyleSchema` (hex — `/^#[0-9a-f]{6}$/i`).
  - `SCHEMA_VERSION = 1`, `DEFAULT_ADJUSTMENTS`, `DEFAULT_GLOBAL` (значения из Global Constraints).
  - `type PresetId = 'graphite'|'midnight'|'oled'|'warm'|'contrast'`; `PRESETS: ReadonlyArray<{ id: PresetId; nameKey: \`preset_${PresetId}\`; colors: StyleColors }>` (ядро не импортирует ничего из `src/ui`); `findStyle(id: string, user: UserStyle[]): { id: string; colors: StyleColors }` (неизвестный id → `graphite`).
  - `type Patch<T> = { [K in keyof T]?: T[K] | null }` (`null` = удалить поле); `applyGlobalPatch(g: GlobalSettings, p: Partial<GlobalSettings>): GlobalSettings` (adj сливается поле-в-поле); `applySitePatch(s: SiteSettings | undefined, p: Patch<SiteSettings>): SiteSettings | undefined` (пустой объект → `undefined`).

- [ ] **Step 1: Написать падающие тесты**

```ts
// presets.test.ts
test.each(PRESETS)('$id: контраст text/bg, textMuted/bg, onAccent/accent, link/bg ≥ 4.5', ({ colors: c }) => {
  for (const [fg, bg] of [[c.text, c.bg], [c.textMuted, c.bg], [c.onAccent, c.accent], [c.link, c.bg]] as const)
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
});
test('contrast: text/bg ≥ 7', () => { const c = PRESETS.find(p => p.id === 'contrast')!.colors; expect(contrastRatio(c.text, c.bg)).toBeGreaterThanOrEqual(7); });
test('oled.bg = #000000', () => expect(PRESETS.find(p => p.id === 'oled')!.colors.bg).toBe('#000000'));
test('findStyle: неизвестный → graphite; пользовательский находится', () => {
  expect(findStyle('nope', []).id).toBe('graphite');
  const u = { id: 'u1', name: 'Мой', c: PRESETS[1].colors };
  expect(findStyle('u1', [u]).colors).toBe(u.c);
});
// patch.test.ts
test('null удаляет поле, пустой сайт → undefined', () => {
  expect(applySitePatch({ on: true }, { on: null })).toBeUndefined();
  expect(applySitePatch(undefined, { det: true })).toEqual({ det: true });
});
test('adj сливается частично', () => {
  expect(applySitePatch({ adj: { br: 90 } }, { adj: { sp: 10 } })).toEqual({ adj: { br: 90, sp: 10 } });
  expect(applyGlobalPatch(DEFAULT_GLOBAL, { adj: { ...DEFAULT_ADJUSTMENTS, br: 120 } }).adj.br).toBe(120);
});
// schema.test.ts
test('DEFAULT_GLOBAL проходит схему; br=200 — нет', () => {
  expect(GlobalSettingsSchema.safeParse(DEFAULT_GLOBAL).success).toBe(true);
  expect(GlobalSettingsSchema.safeParse({ ...DEFAULT_GLOBAL, adj: { ...DEFAULT_ADJUSTMENTS, br: 200 } }).success).toBe(false);
});
```

- [ ] **Step 2: Run** `npx vitest run src/core/settings` — Expected: FAIL.

- [ ] **Step 3: Реализовать.** Цвета встроенных стилей — ровно эти (порядок ключей как в `STYLE_KEYS`):

| id | bg | surface | elevated | text | textMuted | onAccent | link | linkVisited | border | accent | success | warning | danger | selection |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| graphite | #1e1f22 | #26282c | #303236 | #e3e3e3 | #a0a4ab | #10141a | #7cb4ff | #c49cff | #3c3f44 | #6ea8fe | #5fc47e | #e8b04a | #f2706b | #2f4a73 |
| midnight | #0f1724 | #162133 | #1e2b40 | #dbe4f0 | #8fa0b8 | #0b1220 | #79b8ff | #b392f0 | #2a3a52 | #4f9cf9 | #4cc38a | #e5b454 | #f47174 | #24476f |
| oled | #000000 | #0d0d0d | #1a1a1a | #e6e6e6 | #9a9a9a | #000000 | #6cb6ff | #c8a2ff | #2b2b2b | #5aa9ff | #4ade80 | #facc15 | #f87171 | #1f3a5f |
| warm | #221c17 | #2b241e | #352d26 | #eadfcf | #b3a48f | #1d1712 | #e6b673 | #d49a8a | #43382e | #d9a35b | #9cc27a | #e6b450 | #e07a5f | #5a4632 |
| contrast | #000000 | #0a0a0a | #141414 | #ffffff | #d0d0d0 | #000000 | #66ccff | #ff99ff | #ffffff | #ffd400 | #33ff99 | #ffcc00 | #ff5c5c | #0050a0 |

Если тест контраста падает на каком-то цвете — сдвинуть светлоту этого цвета минимально, чтобы пройти порог, и обновить таблицу в этом плане.

- [ ] **Step 4: Run** `npx vitest run src/core/settings` — Expected: PASS.

- [ ] **Step 5: Коммит** `git commit -am "feat(core): settings schema, defaults, presets, patches"` (с `git add src/core/settings`).

---

### Task 4: Итоговая конфигурация, решение «применять», регистрация заглушки

**Files:**
- Create: `src/core/settings/resolve.ts`, `src/core/settings/registration.ts`, тесты `resolve.test.ts`, `registration.test.ts`

**Interfaces:**
- Consumes: типы и `findStyle` (Task 3).
- Produces:
  - `siteKey(url: string): string | null`.
  - ```ts
    interface EffectiveConfig {
      host: string; enabled: boolean; followSystem: boolean; ignoreDetection: boolean;
      engine: Engine; styleId: string; colors: StyleColors; adj: Adjustments;
      keepBgImages: boolean; overrides: OverrideRule[];
    }
    ```
  - `resolveConfig(host: string, g: GlobalSettings, site: SiteSettings | undefined, user: UserStyle[]): EffectiveConfig` — `enabled = site?.on ?? g.def === 'on'`; `adj = {...g.adj, ...site?.adj}`; `engine = site?.eng ?? g.eng`; `styleId = site?.st ?? g.st`.
  - `type ApplyStatus = 'active' | 'off' | 'system-light' | 'already-dark'`.
  - `shouldApply(cfg: EffectiveConfig, env: { systemDark: boolean; pageIsDark: boolean | null }): { apply: boolean; status: ApplyStatus }` — правила §5.1 по порядку; `pageIsDark: null` = ещё не определено (как «не тёмная»).
  - `interface Registration { file: 'placeholder.js' | 'placeholder-sys.js'; matches: string[]; excludeMatches: string[] }`; `computeRegistration(g: GlobalSettings, sites: Record<string, SiteSettings>): Registration | null` — шаблоны для хоста `h`: `*://h/*` и `*://www.h/*` (второй — только если `h` не начинается с `www.`); `def:'off'` без включённых сайтов → `null`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// resolve.test.ts
test.each([
  ['https://www.Example.com/a', 'example.com'], ['http://mail.google.com', 'mail.google.com'],
  ['chrome://extensions', null], ['file:///c:/x.html', null], ['not a url', null],
])('siteKey(%s) = %s', (u, k) => expect(siteKey(u)).toBe(k));

const g = DEFAULT_GLOBAL;
const env = (systemDark = true, pageIsDark: boolean | null = false) => ({ systemDark, pageIsDark });
test.each([
  // [def, site, sys, systemDark, pageIsDark, apply, status]
  ['on',  {},                 false, true,  false, true,  'active'],
  ['on',  { on: false },      false, true,  false, false, 'off'],
  ['off', {},                 false, true,  false, false, 'off'],
  ['off', { on: true },       false, true,  false, true,  'active'],
  ['on',  {},                 true,  false, false, false, 'system-light'],
  ['on',  {},                 true,  true,  false, true,  'active'],
  ['on',  {},                 false, true,  true,  false, 'already-dark'],
  ['on',  { det: true },      false, true,  true,  true,  'active'],
  ['on',  { on: false },      true,  false, true,  false, 'off'],      // правило 1 раньше 3 и 4
  ['on',  {},                 false, true,  null,  true,  'active'],
] as const)('def=%s site=%j sys=%s sd=%s dark=%s → %s/%s', (def, site, sys, sd, dark, apply, status) => {
  const cfg = resolveConfig('x.com', { ...g, def, sys }, site as SiteSettings, []);
  expect(shouldApply(cfg, env(sd, dark))).toEqual({ apply, status });
});
test('adj сайта перекрывает поле-в-поле', () => {
  expect(resolveConfig('x.com', g, { adj: { br: 80 } }, []).adj).toEqual({ ...g.adj, br: 80 });
});
// registration.test.ts
test('def on: все сайты, кроме выключенных', () => {
  expect(computeRegistration({ ...g, def: 'on' }, { 'a.com': { on: false }, 'b.com': { det: true } }))
    .toEqual({ file: 'placeholder.js', matches: ['<all_urls>'], excludeMatches: ['*://a.com/*', '*://www.a.com/*'] });
});
test('def off: только включённые; sys → файл sys', () => {
  expect(computeRegistration({ ...g, def: 'off', sys: true }, { 'a.com': { on: true }, 'b.com': {} }))
    .toEqual({ file: 'placeholder-sys.js', matches: ['*://a.com/*', '*://www.a.com/*'], excludeMatches: [] });
});
test('def off без включённых → null', () => expect(computeRegistration({ ...g, def: 'off' }, {})).toBeNull());
```

- [ ] **Step 2: Run** `npx vitest run src/core/settings` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `resolve.ts` и `registration.ts` по интерфейсам.
- [ ] **Step 4: Run** `npx vitest run src/core/settings` — Expected: PASS.
- [ ] **Step 5: Коммит** `git add src/core/settings && git commit -m "feat(core): config resolution, apply decision, placeholder registration"`

---

### Task 5: Стратегия «Адаптивный», ползунки, функция цвета

**Files:**
- Create: `src/core/mapping/types.ts`, `adaptive.ts`, `adjust.ts`, `color-fn.ts`, тесты `adaptive.test.ts`, `adjust.test.ts`, `color-fn.test.ts`

**Interfaces:**
- Consumes: `Oklch`, `parseColor`, `formatColor`, `isNeutral` (Task 2); `StyleColors`, `Adjustments` (Task 3).
- Produces:
  - `type Role = 'bg' | 'text' | 'border' | 'shadow'`.
  - `interface RuleContext { selector: string; isLink: boolean; isVisited: boolean; pairedBg?: Oklch }`.
  - `interface PageColorStats { entries: Array<{ color: Oklch; role: Role; count: number; isLink: boolean }>; baseBg: Oklch | null }` (используется в плане 2).
  - `interface ColorMapper { prepare(stats: PageColorStats): void; map(color: Oklch, role: Role, ctx: RuleContext): Oklch }`.
  - `createAdaptiveMapper(colors: StyleColors): ColorMapper`.
  - `applyAdjustments(c: Oklch, adj: Adjustments, bgL: number): Oklch`.
  - `type ColorFn = (color: Oklch, role: Role, ctx: RuleContext) => string`; `createColorFn(mapper: ColorMapper, adj: Adjustments, colors: StyleColors): ColorFn` — мемоизация по ключу `${l},${c},${h},${alpha}|${role}|${isLink}${isVisited}`; `bgL` = светлота `colors.bg`.

Алгоритм `map` — ровно §6.2 спецификации (константы 0.06, 0.10, 0.12, 0.3, 0.6; ссылки по умолчанию `#0000ee`/`#551a8b` или нейтральные при `isLink` → `link`/`linkVisited`). Тонировка нейтральных: при `isNeutral(input)` результату присваиваются `h`, `c` соответствующего цвета стиля (`bg` для ролей `bg`/`shadow`, `text` для `text`, `border` для `border`). `applyAdjustments` — §6.7: `l' = l × br/100`; контраст: `l'' = bgL + (l' − bgL) × ct/100`; сепия: линейное смешивание L/C/h к `oklch(0.6 0.05 70)` на `sp/100` (h по кратчайшей дуге); оттенки серого: `c × (1 − gs/100)`; итог `l` ограничивается 0..1.

- [ ] **Step 1: Написать падающие тесты**

```ts
// adaptive.test.ts
const C = PRESETS[0].colors; // graphite
const m = createAdaptiveMapper(C);
const ctx: RuleContext = { selector: 'div', isLink: false, isVisited: false };
const L = (s: string) => parseColor(s)!.l;

test('белый фон → bg стиля', () => expect(formatColor(m.map(parseColor('#fff')!, 'bg', ctx))).toBe(C.bg));
test('чёрный текст → text стиля', () => expect(formatColor(m.map(parseColor('#000')!, 'text', ctx))).toBe(C.text));
test('оттенок цветного фона сохраняется (±3°)', () => {
  const src = parseColor('#cfe3ff')!; expect(Math.abs(m.map(src, 'bg', ctx).h - src.h)).toBeLessThan(3);
});
test('насыщенность фона ≤ 0.12', () => expect(m.map(parseColor('#ffeb3b')!, 'bg', ctx).c).toBeLessThanOrEqual(0.12 + 1e-6));
test('монотонность фона: светлее на входе → не светлее на выходе (1000 случайных пар)', () => {
  const rnd = mulberry32(42);   // детерминированный генератор, объявить в тесте
  for (let i = 0; i < 1000; i++) {
    const a = { l: 0.5 + rnd() * 0.5, c: rnd() * 0.1, h: rnd() * 360, alpha: 1 };
    const b = { ...a, l: Math.min(1, a.l + 0.01 + rnd() * 0.2) };
    expect(m.map(b, 'bg', ctx).l).toBeLessThanOrEqual(m.map(a, 'bg', ctx).l + 1e-9);
  }
});
test('тёмный фон остаётся тёмным', () => expect(m.map(parseColor('#202020')!, 'bg', ctx).l).toBeLessThanOrEqual(L(C.surface) + 0.10 + 1e-6));
test('светлый текст остаётся светлым', () => expect(m.map(parseColor('#eeeeee')!, 'text', ctx).l).toBeGreaterThanOrEqual(L(C.textMuted) - 1e-6));
test('ссылка по умолчанию → link / linkVisited', () => {
  expect(formatColor(m.map(parseColor('#0000ee')!, 'text', { ...ctx, isLink: true }))).toBe(C.link);
  expect(formatColor(m.map(parseColor('#551a8b')!, 'text', { ...ctx, isLink: true, isVisited: true }))).toBe(C.linkVisited);
});
test('альфа сохраняется', () => expect(m.map(parseColor('rgba(255,255,255,.4)')!, 'bg', ctx).alpha).toBeCloseTo(0.4));
test('тень: L×0.3, альфа×0.6', () => {
  const r = m.map(parseColor('rgba(0,0,0,.5)')!, 'shadow', ctx); expect(r.alpha).toBeCloseTo(0.3);
});
// adjust.test.ts
const base = parseColor('#808080')!;
test('по умолчанию — без изменений', () => expect(applyAdjustments(base, DEFAULT_ADJUSTMENTS, 0.2)).toEqual(base));
test('br=50 вдвое снижает L', () => expect(applyAdjustments(base, { ...DEFAULT_ADJUSTMENTS, br: 50 }, 0.2).l).toBeCloseTo(base.l / 2));
test('gs=100 → c=0', () => expect(applyAdjustments(parseColor('#3366ff')!, { ...DEFAULT_ADJUSTMENTS, gs: 100 }, 0.2).c).toBe(0));
test('L в пределах 0..1 при br=150', () => expect(applyAdjustments(parseColor('#fff')!, { ...DEFAULT_ADJUSTMENTS, br: 150 }, 0.2).l).toBeLessThanOrEqual(1));
// color-fn.test.ts
test('мемоизация: mapper.map вызывается один раз на ключ', () => {
  const spy = { prepare() {}, map: vi.fn((c: Oklch) => c) };
  const fn = createColorFn(spy, DEFAULT_ADJUSTMENTS, PRESETS[0].colors);
  fn(parseColor('#fff')!, 'bg', ctx); fn(parseColor('#ffffff')!, 'bg', ctx);
  expect(spy.map).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run** `npx vitest run src/core/mapping` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `types.ts`, `adaptive.ts`, `adjust.ts`, `color-fn.ts` по интерфейсам выше. `prepare` в адаптивной стратегии — пустой метод.
- [ ] **Step 4: Run** `npx vitest run src/core/mapping` — Expected: PASS.
- [ ] **Step 5: Коммит** `git add src/core/mapping && git commit -m "feat(core): adaptive color mapper and adjustments"`

---

### Task 6: CSS-преобразования: роли свойств, значения, переменные, базовые правила, классификация тёмности

**Files:**
- Create: `src/core/css/declarations.ts`, `vars.ts`, `base.ts`, `src/core/detect.ts`, тесты рядом

**Interfaces:**
- Consumes: `parseColor`, `formatColor` (Task 2); `Role`, `RuleContext`, `ColorFn` (Task 5); `StyleColors`, `Adjustments` (Task 3).
- Produces:
  - `PROPERTY_ROLES: Readonly<Record<string, Role>>` — **только лонгхенды** (§6.1): `background-color`, `background-image` → `bg`; `color`, `fill`, `stroke`, `caret-color`, `text-decoration-color`, `-webkit-text-fill-color` → `text`; `border-{top,right,bottom,left}-color`, `border-{block,inline}-{start,end}-color`, `outline-color`, `column-rule-color` → `border`; `box-shadow`, `text-shadow` → `shadow`.
  - `roleOf(prop: string): Role | null`.
  - `mapDeclarationValue(prop: string, value: string, fn: ColorFn, ctx: RuleContext): string | null` — заменяет каждый цветовой токен в значении; `null`, если ничего не изменилось или значение нельзя безопасно переписать. Для `background-image`: обрабатываются только градиенты; значение с `url(` → `null`. Токены ищутся регуляркой `#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)|\b[a-z]+\b` (без учёта регистра) с пропуском содержимого `var(...)`; не-цвета (`parseColor` → `null`) остаются как есть.
  - `isLinkSelector(selector: string): { isLink: boolean; isVisited: boolean }` — `a` как тип-селектор в последнем составном селекторе любой из частей через запятую; `isVisited` — наличие `:visited`.
  - `class VarRoleCounter { add(name: string, role: Role): void; roleOf(name: string): Role }` — преобладающая роль; при равенстве или отсутствии — `'bg'`.
  - `collectVarUsage(prop: string, value: string, counter: VarRoleCounter): void` — для каждого `var(--name` в значении свойства с известной ролью.
  - `buildBaseCss(colors: StyleColors, fn: ColorFn, adj: Adjustments): string` — правила §6.4 и §6.5; цвета берутся как `fn(parseColor('#ffffff')!, 'bg', …)` / `fn(parseColor('#000000')!, 'text', …)`, кнопки и поля — `surface`/`border` через `fn` от `#f0f0f0`/`#767676`; `::selection` — `colors.selection` напрямую; `scrollbar-color: <border> <bg>`; `:focus-visible { outline-color: <link> }`; при `adj.img > 0` — `img, video, canvas, picture { filter: brightness(${1 - img/100}) }`.
  - `classifyDarkness(input: { samples: Oklch[]; colorScheme: string; metaScheme: string | null; systemDark: boolean }): 'dark' | 'light' | 'unsure'` — среднее `l`: `< 0.4` → `dark`; `0.4 ≤ l < 0.6` → `dark`, если `colorScheme`/`metaScheme` содержит только `dark` либо (`light dark` и `systemDark`), иначе `unsure`; `≥ 0.6` → `light`; пустые `samples` → `unsure`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// declarations.test.ts
const fn: ColorFn = (c, role) => (role === 'bg' ? '#111111' : '#eeeeee');
const ctx = { selector: 'p', isLink: false, isVisited: false };
test.each([
  ['background-color', '#fff', '#111111'],
  ['color', 'rgb(0 0 0)', '#eeeeee'],
  ['box-shadow', '0 1px 2px rgba(0,0,0,.2), inset 0 0 0 1px #ccc', '0 1px 2px #111111, inset 0 0 0 1px #111111'],
  ['background-image', 'linear-gradient(90deg, #fff 0%, rgba(240,240,240,1) 100%)', 'linear-gradient(90deg, #111111 0%, #111111 100%)'],
])('%s: %s → %s', (p, v, out) => expect(mapDeclarationValue(p, v, fn, ctx)).toBe(out));
test.each([
  ['color', 'transparent'], ['color', 'currentColor'], ['color', 'inherit'], ['color', 'var(--fg)'],
  ['color', 'CanvasText'], ['color', 'color-mix(in srgb, red, blue)'],
  ['background-image', 'url(a.png)'], ['background-image', 'linear-gradient(#fff, #000), url(a.png)'],
  ['background-image', 'none'], ['width', '10px'],
])('%s: %s → null', (p, v) => expect(mapDeclarationValue(p, v, fn, ctx)).toBeNull());
test('var() с fallback-цветом: заменяется только fallback', () =>
  expect(mapDeclarationValue('color', 'var(--x, #000)', fn, ctx)).toBe('var(--x, #eeeeee)'));
test.each([['a', true, false], ['nav a:hover', true, false], ['a:visited', true, true], ['.btn, a.link', true, false], ['abbr', false, false], ['a span', false, false]])
  ('isLinkSelector(%s)', (s, l, v) => expect(isLinkSelector(s)).toEqual({ isLink: l, isVisited: v }));
// vars.test.ts
test('преобладающая роль и умолчание bg', () => {
  const c = new VarRoleCounter();
  collectVarUsage('color', 'var(--fg)', c); collectVarUsage('border-top-color', 'var(--fg)', c); collectVarUsage('color', 'var(--fg)', c);
  expect(c.roleOf('--fg')).toBe('text'); expect(c.roleOf('--unknown')).toBe('bg');
});
// base.test.ts
test('базовые правила содержат html/body и ::selection; img-фильтр только при img>0', () => {
  const css = buildBaseCss(PRESETS[0].colors, fn, DEFAULT_ADJUSTMENTS);
  expect(css).toMatch(/html,\s*body\s*\{[^}]*background-color:\s*#111111/);
  expect(css).toContain('::selection'); expect(css).not.toContain('brightness(');
  expect(buildBaseCss(PRESETS[0].colors, fn, { ...DEFAULT_ADJUSTMENTS, img: 20 })).toContain('brightness(0.8)');
});
// detect.test.ts
const s = (l: number) => Array(9).fill({ l, c: 0, h: 0, alpha: 1 });
test.each([
  [0.2, 'normal', null, false, 'dark'], [0.95, 'normal', null, true, 'light'],
  [0.5, 'dark', null, false, 'dark'], [0.5, 'normal', 'light dark', true, 'dark'],
  [0.5, 'normal', 'light dark', false, 'unsure'], [0.95, 'dark', null, true, 'light'],
] as const)('L=%s scheme=%s meta=%s sys=%s → %s', (l, cs, ms, sd, r) =>
  expect(classifyDarkness({ samples: s(l), colorScheme: cs, metaScheme: ms, systemDark: sd })).toBe(r));
```

- [ ] **Step 2: Run** `npx vitest run src/core/css src/core/detect.test.ts` — Expected: FAIL.
- [ ] **Step 3: Реализовать** модули по интерфейсам.
- [ ] **Step 4: Run** `npx vitest run src/core` — Expected: PASS.
- [ ] **Step 5: Коммит** `git add src/core && git commit -m "feat(core): declaration mapping, css vars, base rules, darkness classification"`

---

### Task 7: Сообщения, поддельный `chrome`, хранилище настроек в service worker

**Files:**
- Create: `src/shared/messages.ts`, `tests/fakes/chrome.ts`, `src/background/settings-store.ts`, `src/background/settings-store.test.ts`

**Interfaces:**
- Consumes: типы и `applyGlobalPatch`/`applySitePatch`, `DEFAULT_GLOBAL`, `SiteSettingsSchema`, `GlobalSettingsSchema` (Task 3); `EffectiveConfig`, `ApplyStatus` (Task 4).
- Produces:
  - `src/shared/messages.ts`:
    ```ts
    type TabStatus = ApplyStatus | 'error' | 'heavy' | 'unsupported';
    interface TabState { status: TabStatus; detectedDark: boolean }
    interface Snapshot { g: GlobalSettings; styles: UserStyle[]; sites: Record<string, SiteSettings> }
    type Request =
      | { type: 'GET_CONFIG' }                                             // → EffectiveConfig | null
      | { type: 'FETCH_CSS'; url: string }                                 // → { text: string } | { error: string }
      | { type: 'REPORT_STATE'; state: TabState }                          // → void
      | { type: 'GET_TAB_STATE'; tabId: number }                           // → PopupState
      | { type: 'UPDATE_GLOBAL'; patch: Partial<GlobalSettings> }          // → void
      | { type: 'UPDATE_SITE'; host: string; patch: Patch<SiteSettings> | null }; // null = удалить сайт
    type ContentMessage = { type: 'CONFIG_CHANGED'; config: EffectiveConfig | null };
    interface PopupState { host: string | null; state: TabState; snapshot: Snapshot }
    function sendToBackground<R extends Request>(msg: R): Promise<ResponseOf<R>>;
    ```
  - `tests/fakes/chrome.ts`: `installFakeChrome(): FakeChrome` — in-memory `storage.{sync,local,session}` (`get/set/remove/getBytesInUse`, `onChanged` с `addListener` и ручным `emit`), `runtime.onMessage`, `runtime.sendMessage`, `tabs.query/sendMessage`, `scripting.registerContentScripts/updateContentScripts/unregisterContentScripts/getRegisteredContentScripts`, `action.setBadgeText/setBadgeBackgroundColor`, `commands.onCommand`, `i18n.getMessage`; все методы — `vi.fn`, промисные.
  - `class SettingsStore { constructor(opts?: { debounceMs?: number }); ready: Promise<void>; snapshot(): Snapshot; updateGlobal(patch: Partial<GlobalSettings>): void; updateSite(host: string, patch: Patch<SiteSettings> | null): void; onChange(cb: (s: Snapshot) => void): () => void; flush(): Promise<void> }` — загрузка из `sync` (ключи `g`, `styles`, `s:*`, невалидные записи по zod отбрасываются с `console.warn('[DarkExt] …')`), изменения применяются в памяти и сразу вызывают `onChange`; запись в `sync` — debounce 500 мс **по ключу**; внешние изменения `storage.onChanged` (area `sync`) перечитывают ключ и вызывают `onChange`, кроме изменений, совпадающих с только что записанными значениями.

- [ ] **Step 1: Написать падающие тесты**

```ts
// settings-store.test.ts
beforeEach(() => { installFakeChrome(); vi.useFakeTimers(); });
test('пустое хранилище → умолчания', async () => {
  const s = new SettingsStore(); await s.ready; expect(s.snapshot().g).toEqual(DEFAULT_GLOBAL);
});
test('10 быстрых изменений → одна запись с последним значением, 10 уведомлений', async () => {
  const s = new SettingsStore(); await s.ready; const cb = vi.fn(); s.onChange(cb);
  for (let i = 0; i < 10; i++) s.updateGlobal({ adj: { ...DEFAULT_GLOBAL.adj, br: 100 + i } });
  expect(cb).toHaveBeenCalledTimes(10);
  await vi.advanceTimersByTimeAsync(500);
  expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);
  expect((chrome.storage.sync.set as Mock).mock.calls[0][0].g.adj.br).toBe(109);
});
test('updateSite(null) удаляет ключ s:<host>', async () => {
  await chrome.storage.sync.set({ 's:a.com': { on: true } });
  const s = new SettingsStore(); await s.ready; s.updateSite('a.com', null);
  await vi.advanceTimersByTimeAsync(500);
  expect(chrome.storage.sync.remove).toHaveBeenCalledWith('s:a.com');
  expect(s.snapshot().sites['a.com']).toBeUndefined();
});
test('невалидная запись сайта отбрасывается', async () => {
  await chrome.storage.sync.set({ 's:bad.com': { on: 'yes' } });
  const s = new SettingsStore(); await s.ready; expect(s.snapshot().sites['bad.com']).toBeUndefined();
});
test('внешнее изменение с другого устройства → onChange', async () => {
  const s = new SettingsStore(); await s.ready; const cb = vi.fn(); s.onChange(cb);
  (chrome.storage.onChanged as any).emit({ 's:x.com': { newValue: { on: false } } }, 'sync');
  await vi.runAllTimersAsync();
  expect(s.snapshot().sites['x.com']).toEqual({ on: false }); expect(cb).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run** `npx vitest run src/background` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `messages.ts`, `tests/fakes/chrome.ts`, `settings-store.ts` по интерфейсам.
- [ ] **Step 4: Run** `npx vitest run src/background` — Expected: PASS.
- [ ] **Step 5: Коммит** `git add src/shared tests/fakes src/background && git commit -m "feat(bg): message protocol and debounced settings store"`

---

### Task 8: Service worker: маршрутизатор, рассылка, регистрация заглушки, CSS-загрузка, значок, горячие клавиши

**Files:**
- Create: `src/background/tab-state.ts`, `registration.ts`, `css-fetch.ts`, `badge.ts`, `commands.ts`, `router.ts`, `index.ts` (заменить заглушку), тесты `router.test.ts`, `registration.test.ts`, `css-fetch.test.ts`, `commands.test.ts`

**Interfaces:**
- Consumes: `SettingsStore` (Task 7), `resolveConfig`, `siteKey`, `computeRegistration` (Task 4), сообщения (Task 7).
- Produces:
  - `class TabStateStore { get(tabId: number): Promise<TabState | undefined>; set(tabId: number, s: TabState): Promise<void> }` — `chrome.storage.session`, ключ `tab:<id>`; очистка в `chrome.tabs.onRemoved`.
  - `syncRegistration(reg: Registration | null): Promise<void>` — id `darkext-placeholder`, `runAt: 'document_start'`, `allFrames: false`, `persistAcrossSessions: true`; `null` → `unregister`; иначе `register` или `update` (если уже есть); пропуск вызова, если регистрация не изменилась.
  - `fetchCss(url: string): Promise<string>` — только `http:`/`https:` (иначе ошибка `unsupported scheme`), `credentials: 'omit'`, таймаут 10 000 мс (`AbortController`), кэш `Map<string, Promise<string>>` на время жизни worker; ответ не-2xx → ошибка.
  - `setBadge(tabId: number, status: TabStatus): Promise<void>` — `active`/`unsupported` → `''`; `off`/`system-light` → `'off'`; `already-dark` → `'auto'`; `error` → `'!'` (фон `#d93025`); `heavy` → `'~'`.
  - `handleCommand(command: string, tab: chrome.tabs.Tab | undefined, store: SettingsStore): void` — `toggle-site`: для `siteKey(tab.url)` ставит `on = !resolveConfig(...).enabled`; `toggle-global`: `def` on↔off; неподдерживаемый URL — ничего.
  - `createRouter(store: SettingsStore, tabs: TabStateStore): (msg: Request, sender: chrome.runtime.MessageSender) => Promise<unknown>` — `GET_CONFIG`: по `sender.tab.url` → `EffectiveConfig` или `null` для неподдерживаемых; `FETCH_CSS`; `REPORT_STATE`: только `sender.frameId === 0` → `tabs.set` + `setBadge`; `GET_TAB_STATE`: `host` из `chrome.tabs.get(tabId).url`, состояние (`unsupported` при `host === null`, иначе из `TabStateStore` или `{status:'off', detectedDark:false}`), `snapshot`; `UPDATE_GLOBAL`/`UPDATE_SITE` → store.
  - `broadcast(store: SettingsStore): Promise<void>` — для каждой вкладки из `chrome.tabs.query({})` с поддерживаемым URL отправляет `CONFIG_CHANGED` с её конфигурацией; ошибки «нет получателя» игнорируются.
  - `index.ts`: `store.onChange` → `broadcast` + `syncRegistration(computeRegistration(...))`; `runtime.onMessage` → router (возвращает `true` и отвечает асинхронно); `commands.onCommand` → `handleCommand`; при старте после `store.ready` — `syncRegistration`.

- [ ] **Step 1: Написать падающие тесты**

```ts
// router.test.ts
beforeEach(() => installFakeChrome());
const sender = (url: string, frameId = 0) => ({ tab: { id: 7, url } as chrome.tabs.Tab, frameId });
test('GET_CONFIG: конфигурация по URL вкладки; для chrome:// — null', async () => {
  const store = new SettingsStore(); await store.ready; const r = createRouter(store, new TabStateStore());
  expect(await r({ type: 'GET_CONFIG' }, sender('https://www.a.com/x'))).toMatchObject({ host: 'a.com', enabled: true, engine: 'adaptive' });
  expect(await r({ type: 'GET_CONFIG' }, sender('chrome://settings'))).toBeNull();
});
test('REPORT_STATE из iframe игнорируется, из верхнего фрейма — сохраняется и ставит значок', async () => {
  const store = new SettingsStore(); await store.ready; const tabs = new TabStateStore(); const r = createRouter(store, tabs);
  await r({ type: 'REPORT_STATE', state: { status: 'already-dark', detectedDark: true } }, sender('https://a.com', 3));
  expect(await tabs.get(7)).toBeUndefined();
  await r({ type: 'REPORT_STATE', state: { status: 'already-dark', detectedDark: true } }, sender('https://a.com'));
  expect(await tabs.get(7)).toEqual({ status: 'already-dark', detectedDark: true });
  expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 7, text: 'auto' });
});
// registration.test.ts
test('register → update → unregister; повтор без изменений не вызывает API', async () => {
  installFakeChrome();
  const reg = { file: 'placeholder.js', matches: ['<all_urls>'], excludeMatches: [] } as const;
  await syncRegistration(reg); expect(chrome.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
  await syncRegistration(reg); expect(chrome.scripting.updateContentScripts).not.toHaveBeenCalled();
  await syncRegistration({ ...reg, excludeMatches: ['*://a.com/*'] }); expect(chrome.scripting.updateContentScripts).toHaveBeenCalledTimes(1);
  await syncRegistration(null); expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['darkext-placeholder'] });
});
// css-fetch.test.ts
test('кэш, credentials omit, ошибки схемы и статуса', async () => {
  const f = vi.fn(async () => new Response('a{color:red}', { status: 200 })); vi.stubGlobal('fetch', f);
  expect(await fetchCss('https://cdn.x/a.css')).toBe('a{color:red}');
  await fetchCss('https://cdn.x/a.css'); expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
  await expect(fetchCss('data:text/css,a{}')).rejects.toThrow('unsupported scheme');
  f.mockResolvedValueOnce(new Response('', { status: 404 })); await expect(fetchCss('https://cdn.x/b.css')).rejects.toThrow();
});
// commands.test.ts
test('toggle-site инвертирует итоговое включение; toggle-global меняет def', async () => {
  installFakeChrome(); const store = new SettingsStore(); await store.ready;
  handleCommand('toggle-site', { url: 'https://a.com/' } as chrome.tabs.Tab, store);
  expect(store.snapshot().sites['a.com']).toEqual({ on: false });
  handleCommand('toggle-global', undefined, store); expect(store.snapshot().g.def).toBe('off');
  handleCommand('toggle-site', { url: 'chrome://x' } as chrome.tabs.Tab, store); // без эффекта и без исключения
});
```

- [ ] **Step 2: Run** `npx vitest run src/background` — Expected: FAIL.
- [ ] **Step 3: Реализовать** модули по интерфейсам.
- [ ] **Step 4: Run** `npx vitest run src/background && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Коммит** `git add src/background && git commit -m "feat(bg): router, broadcast, placeholder registration, css fetch, badge, commands"`

---

### Task 9: Конвейер: запись стилей, inline-стили, зеркалирование одного документа

**Files:**
- Create: `src/content/pipeline/sheets.ts`, `mirror.ts`, `writer.ts`, `inline.ts`, тесты `mirror.test.ts`, `writer.test.ts`, `inline.test.ts` (все `// @vitest-environment jsdom`)

**Interfaces:**
- Consumes: `roleOf`, `mapDeclarationValue`, `isLinkSelector`, `VarRoleCounter`, `collectVarUsage` (Task 6); `ColorFn`, `RuleContext` (Task 5); `parseColor` (Task 2).
- Produces:
  - `readRules(sheet: CSSStyleSheet): CSSRuleList | 'cross-origin' | 'pending'` — `SecurityError` → `'cross-origin'`; `null`/`InvalidAccessError` → `'pending'`.
  - `parseCssText(text: string): CSSRuleList` — разбор через `<style>` в отдельном документе `document.implementation.createHTMLDocument('')` (без влияния на страницу; работает и в jsdom).
  - `extractImports(text: string, baseUrl: string): string[]` — абсолютные URL из `@import url(...)`/`@import "..."`.
  - `countVarUsage(rules: CSSRuleList, counter: VarRoleCounter): void`.
  - `buildMirrorCss(rules: CSSRuleList, fn: ColorFn, vars: VarRoleCounter): string` — рекурсия по `CSSMediaRule`/`CSSSupportsRule`/`CSSLayerBlockRule`/`CSSContainerRule` (обёртка тем же `@`-префиксом и `conditionText`/`name`); для `CSSStyleRule` перебор `style.item(i)` (лонгхенды): цветовые свойства через `mapDeclarationValue`, кастомные свойства `--x` с цветовым значением — по `vars.roleOf('--x')`; `!important` сохраняется (`style.getPropertyPriority`); `ctx` из `isLinkSelector(selectorText)` и `pairedBg` = исходный `background-color` правила; правила без изменений не выводятся.
  - `class StyleWriter { constructor(doc: Document); setBase(css: string): void; setMirror(source: Element | CSSStyleSheet, css: string, root?: Document | ShadowRoot): void; removeMirror(source: Element | CSSStyleSheet): void; setDisabled(disabled: boolean): void; clear(): void }` — `base` вставляется **первым** ребёнком `head` (или `documentElement`, если `head` ещё нет; переносится в `head` при его появлении через `ensureHead()`), зеркало элемента `<style>`/`<link>` — сразу после него, зеркало `CSSStyleSheet` без владельца (adopted) — constructed-лист, добавляемый в `root.adoptedStyleSheets`; `setDisabled` ставит `media="not all"` / `sheet.disabled`; все наши элементы с `data-darkext`.
  - `class InlineStyler { apply(el: Element, fn: ColorFn): void; restoreAll(): void; isOwnMutation(r: MutationRecord): boolean }` — оригинал атрибута `style` хранится в `WeakMap` (и множество обработанных элементов для `restoreAll`); собственные изменения отмечаются, чтобы наблюдатель их пропускал.

- [ ] **Step 1: Написать падающие тесты**

```ts
// mirror.test.ts
const fn: ColorFn = (c, role) => (role === 'bg' ? '#111111' : role === 'text' ? '#eeeeee' : '#333333');
test('зеркало: селектор, только цветовые свойства, !important, @media', () => {
  const rules = parseCssText(`.a{color:#000;width:10px;background-color:#fff!important}@media (min-width:1px){.b{border-top-color:#ccc}}.c{width:1px}`);
  const css = buildMirrorCss(rules, fn, new VarRoleCounter());
  expect(css).toContain('.a{color:#eeeeee;background-color:#111111 !important;}');
  expect(css).toMatch(/@media \(min-width: ?1px\)\s*\{\s*\.b\{border-top-color:#333333;\}\s*\}/);
  expect(css).not.toContain('width'); expect(css).not.toContain('.c');
});
test('кастомное свойство перекрашивается по роли использования', () => {
  const rules = parseCssText(`:root{--fg:#000}.t{color:var(--fg)}`);
  const vars = new VarRoleCounter(); countVarUsage(rules, vars);
  expect(buildMirrorCss(rules, fn, vars)).toContain(':root{--fg:#eeeeee;}');
});
test('extractImports', () =>
  expect(extractImports(`@import url("x.css"); @import 'y.css' screen;`, 'https://a.com/css/main.css'))
    .toEqual(['https://a.com/css/x.css', 'https://a.com/css/y.css']));
// writer.test.ts
test('base первым в head, зеркало сразу после источника, clear убирает всё', () => {
  document.head.innerHTML = '<style id="s1">.a{}</style>';
  const w = new StyleWriter(document); const s1 = document.getElementById('s1')!;
  w.setBase('html{}'); w.setMirror(s1, '.a{color:red}');
  expect(document.head.firstElementChild!.getAttribute('data-darkext')).toBe('base');
  expect(s1.nextElementSibling!.getAttribute('data-darkext')).toBe('mirror');
  w.setMirror(s1, '.a{color:blue}'); expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
  w.clear(); expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
});
test('без <head>: base в documentElement', () => {
  const doc = document.implementation.createHTMLDocument(''); doc.head.remove();
  const w = new StyleWriter(doc); w.setBase('html{}');
  expect(doc.documentElement.querySelector('[data-darkext=base]')).not.toBeNull();
});
test('setDisabled переключает media', () => {
  const w = new StyleWriter(document); w.setBase('html{}'); w.setDisabled(true);
  expect(document.querySelector('[data-darkext=base]')!.getAttribute('media')).toBe('not all');
});
// inline.test.ts
// fn — та же функция, что в mirror.test.ts (объявить в файле)
test('apply перекрашивает, restoreAll возвращает исходный атрибут побайтно', () => {
  document.body.innerHTML = '<div id="d" style="color: #000; width: 10px"></div><p id="p"></p>';
  const s = new InlineStyler(); const d = document.getElementById('d')!;
  s.apply(d, fn); expect(d.style.color).toBe('rgb(238, 238, 238)');
  s.apply(document.getElementById('p')!, fn); // без style — без изменений
  s.restoreAll(); expect(d.getAttribute('style')).toBe('color: #000; width: 10px');
  expect(document.getElementById('p')!.hasAttribute('style')).toBe(false);
});
```

- [ ] **Step 2: Run** `npx vitest run src/content/pipeline` — Expected: FAIL.
- [ ] **Step 3: Реализовать** модули по интерфейсам.

  Если jsdom не поддерживает какой-то из классов правил (`CSSLayerBlockRule`, `CSSContainerRule`), проверка типа — через `'cssRules' in rule` + чтение `conditionText`/`name`/`media.mediaText` по наличию; тест на `@media` обязателен, остальные `@`-правила проверяются в e2e.

- [ ] **Step 4: Run** `npx vitest run src/content/pipeline` — Expected: PASS.
- [ ] **Step 5: Коммит** `git add src/content/pipeline && git commit -m "feat(content): mirror stylesheets, style writer, inline styler"`

---

### Task 10: Конвейер целиком: планировщик, наблюдатель, `createPipeline`

**Files:**
- Create: `src/content/pipeline/scheduler.ts`, `observer.ts`, `pipeline.ts`, тесты `scheduler.test.ts`, `pipeline.test.ts` (jsdom)

**Interfaces:**
- Consumes: всё из Task 9; `createAdaptiveMapper`, `createColorFn` (Task 5); `buildBaseCss` (Task 6); `EffectiveConfig` (Task 4).
- Produces:
  - `runChunked(tasks: Array<() => void>, opts: { syncCount: number; budgetMs: number; now?: () => number; idle?: (cb: () => void) => void }): Promise<'done' | 'budget'>` — первые `syncCount` задач синхронно, остальные порциями в `idle` (по умолчанию `requestIdleCallback`, fallback `setTimeout(0)`), пока не исчерпан `budgetMs` от старта.
  - `observeRoot(root: Document | ShadowRoot, h: { onSheetNode(n: HTMLStyleElement | HTMLLinkElement): void; onSheetNodeRemoved(n: Element): void; onStyleAttr(el: Element): void; isOwn(r: MutationRecord): boolean }): () => void` — пакетирование через `requestAnimationFrame`; `characterData`/`childList` внутри `<style>` → `onSheetNode`; добавленные элементы с атрибутом `style` (и их потомки) → `onStyleAttr`; наши `[data-darkext]` игнорируются.
  - ```ts
    interface PipelineDeps { fetchCss(url: string): Promise<string> }
    type PipelineStatus = 'ok' | 'heavy' | 'error';
    interface Pipeline {
      start(cfg: EffectiveConfig): void; update(cfg: EffectiveConfig): void; detach(): void;
      setDisabled(disabled: boolean): void; addRoot(root: ShadowRoot): void; refreshSheet(sheet: CSSStyleSheet): void;
      status(): PipelineStatus; onStatus(cb: (s: PipelineStatus) => void): void;
    }
    function createPipeline(doc: Document, deps: PipelineDeps): Pipeline;
    ```
    `start`: создаёт `ColorFn` (для `engine: 'adaptive'`; `'style'` в плане 1 тоже идёт через адаптивную стратегию — заменится в плане 2), `setBase`, обходит `doc.styleSheets` + `doc.adoptedStyleSheets` (сначала считает переменные по всем доступным листам, затем строит зеркала), листы из `<head>` — синхронно, остальные — через `runChunked` (`budgetMs: 3000`, первый проход ограничен 300 мс / 50 000 правил → остаток уходит в чанки); `'cross-origin'` → `deps.fetchCss(href)` (+ рекурсивно `extractImports`) → `parseCssText` → зеркало после `<link>`; `'pending'` → обработка по событию `load` у `ownerNode`; inline-стили всех `[style]`; запуск наблюдателя. `runChunked` вернул `'budget'` → статус `'heavy'` (применённое остаётся). Любое исключение → `detach()` + статус `'error'` + `console.error('[DarkExt]', e)`. Ошибка `fetchCss` → лист пропускается без изменения статуса. Каждая смена статуса вызывает колбэки `onStatus`.
    `update`: пересоздаёт `ColorFn` и перестраивает все зеркала, base и inline без повторной загрузки кросс-доменных листов (кэш текстов в памяти).
    `detach`: отключает наблюдателей, `InlineStyler.restoreAll()`, `StyleWriter.clear()`, удаляет зеркала из всех shadow root.
    `addRoot`: обрабатывает листы и `adoptedStyleSheets` shadow root, зеркала добавляются в `root.adoptedStyleSheets`, запускает `observeRoot(root)`.
    `refreshSheet`: перестраивает зеркало конкретного листа (для `insertRule`/`replaceSync`).

- [ ] **Step 1: Написать падающие тесты**

```ts
// scheduler.test.ts
test('бюджет: задачи после исчерпания не выполняются', async () => {
  let t = 0; const done: number[] = [];
  const tasks = Array.from({ length: 10 }, (_, i) => () => { done.push(i); t += 100; });
  expect(await runChunked(tasks, { syncCount: 2, budgetMs: 450, now: () => t, idle: cb => cb() })).toBe('budget');
  expect(done).toEqual([0, 1, 2, 3, 4]);
});
// pipeline.test.ts
const cfg = (): EffectiveConfig => resolveConfig('a.com', DEFAULT_GLOBAL, undefined, []);
const bgOf = (sel: string) => parseColor(getComputedStyle(document.querySelector(sel)!).backgroundColor)!;
beforeEach(() => { document.head.innerHTML = '<style>.card{background-color:#ffffff}</style>'; document.body.innerHTML = '<div class="card" style="color:#000"></div>'; });

test('start делает фон тёмным, detach возвращает', () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
  expect(bgOf('.card').l).toBeLessThan(0.3);
  p.detach(); expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
});
test('start → detach → start → detach: один набор стилей, inline побайтно восстановлен', () => {
  const p = createPipeline(document, { fetchCss: vi.fn() });
  p.start(cfg()); p.detach(); p.start(cfg());
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
  expect(document.querySelectorAll('[data-darkext=base]').length).toBe(1);
  p.detach(); expect(document.querySelector('.card')!.getAttribute('style')).toBe('color:#000');
});
test('update меняет цвета без дублей', () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const before = document.querySelector('[data-darkext=mirror]')!.textContent;
  p.update({ ...cfg(), colors: PRESETS.find(x => x.id === 'oled')!.colors });
  expect(document.querySelectorAll('[data-darkext=mirror]').length).toBe(1);
  expect(document.querySelector('[data-darkext=mirror]')!.textContent).not.toBe(before);
});
test('исключение внутри → detach и статус error', () => {
  const p = createPipeline(document, { fetchCss: vi.fn() });
  vi.spyOn(document, 'styleSheets', 'get').mockImplementation(() => { throw new Error('boom'); });
  p.start(cfg()); expect(p.status()).toBe('error'); expect(document.querySelectorAll('[data-darkext]').length).toBe(0);
});
test('новый <style> после старта обрабатывается наблюдателем', async () => {
  const p = createPipeline(document, { fetchCss: vi.fn() }); p.start(cfg());
  const s = document.createElement('style'); s.textContent = '.x{background-color:#fff}'; document.head.append(s);
  await new Promise(r => requestAnimationFrame(() => r(null)));
  expect(s.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror');
});
test('pending-лист обрабатывается по load', () => {
  const p = createPipeline(document, { fetchCss: vi.fn() });
  const link = document.createElement('link'); link.rel = 'stylesheet'; document.head.append(link); // sheet === null в jsdom
  p.start(cfg());
  Object.defineProperty(link, 'sheet', { value: { cssRules: parseCssText('.l{color:#000}'), ownerNode: link } });
  link.dispatchEvent(new Event('load'));
  expect(link.nextElementSibling?.getAttribute('data-darkext')).toBe('mirror');
});
```

- [ ] **Step 2: Run** `npx vitest run src/content/pipeline` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `scheduler.ts`, `observer.ts`, `pipeline.ts` по интерфейсам. Если какой-то тест невозможен в jsdom (например, `getComputedStyle` не учитывает порядок листов), заменить проверку на чтение `textContent` зеркала и перенести проверку вычисленного стиля в e2e Task 15; отметить это в комментарии теста.
- [ ] **Step 4: Run** `npx vitest run src/content` — Expected: PASS.
- [ ] **Step 5: Коммит** `git add src/content/pipeline && git commit -m "feat(content): chunked pipeline with observer, cross-origin and pending sheets"`

---

### Task 11: Main-world hook (shadow DOM, adoptedStyleSheets, insertRule)

**Files:**
- Create: `src/main-world/hook.ts` (заменить заглушку), `src/main-world/hook.test.ts` (jsdom)

**Interfaces:**
- Produces (DOM-события, общие для миров):
  - `darkext:shadow` — `CustomEvent` на хост-элементе (`bubbles: true, composed: true`) после `attachShadow` с `mode: 'open'`.
  - `darkext:adopted` — на `document` (или хосте shadow root) после присваивания `adoptedStyleSheets`.
  - `darkext:sheet-changed` — после `CSSStyleSheet.prototype.insertRule/deleteRule/replace/replaceSync`: на `ownerNode`, если он есть, иначе на `document`; `detail` не используется (изолированный мир находит лист сам — см. Task 12).
  - Хук идемпотентен (`window.__darkextHooked`), оригинальные методы вызываются с теми же аргументами и возвращают то же значение; исключения хука не прерывают вызов страницы.

- [ ] **Step 1: Написать падающие тесты**

```ts
// hook.test.ts
beforeAll(async () => { await import('./hook'); await import('./hook'); }); // двойной импорт — без двойной обёртки
test('attachShadow open → darkext:shadow на хосте; closed — без события', () => {
  const cb = vi.fn(); document.addEventListener('darkext:shadow', cb);
  const a = document.createElement('div'); document.body.append(a); a.attachShadow({ mode: 'open' });
  const b = document.createElement('div'); document.body.append(b); b.attachShadow({ mode: 'closed' });
  expect(cb).toHaveBeenCalledTimes(1); expect(cb.mock.calls[0][0].target).toBe(a);
});
test('insertRule → darkext:sheet-changed на ownerNode, правило вставлено', () => {
  const s = document.createElement('style'); document.head.append(s); const cb = vi.fn();
  s.addEventListener('darkext:sheet-changed', cb);
  const idx = s.sheet!.insertRule('.z{color:red}', 0);
  expect(idx).toBe(0); expect(s.sheet!.cssRules.length).toBe(1); expect(cb).toHaveBeenCalledTimes(1);
});
```

(`adoptedStyleSheets` и `replaceSync` не поддерживаются jsdom — проверяются в e2e Task 15.)

- [ ] **Step 2: Run** `npx vitest run src/main-world` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `hook.ts`: обёртки `Element.prototype.attachShadow`, `CSSStyleSheet.prototype.{insertRule,deleteRule,replace,replaceSync}`, сеттеры `adoptedStyleSheets` на `Document.prototype` и `ShadowRoot.prototype` (через `Object.getOwnPropertyDescriptor`, только если свойство существует). Отправка событий — через `queueMicrotask`, чтобы серия `insertRule` давала одно событие на лист за микрозадачу.
- [ ] **Step 4: Run** `npx vitest run src/main-world` — Expected: PASS.
- [ ] **Step 5: Коммит** `git add src/main-world && git commit -m "feat(main-world): hooks for shadow roots, adopted sheets and insertRule"`

---

### Task 12: Детектор, заглушка, точка входа content script

**Files:**
- Create: `src/content/detector.ts`, `src/placeholder/placeholder.ts` (заменить), `src/content/index.ts` (заменить), `src/content/controller.ts`, тесты `controller.test.ts`, `placeholder.test.ts` (jsdom)

**Interfaces:**
- Consumes: `createPipeline` (Task 10), `classifyDarkness` (Task 6), `shouldApply` (Task 4), `parseColor` (Task 2), сообщения (Task 7), события hook (Task 11).
- Produces:
  - `sampleBackgrounds(doc: Document, win: Window): Oklch[]` — 9 точек сетки 3×3 (центры ячеек вьюпорта); для каждой — `elementsFromPoint`, первый элемент с непрозрачным (`alpha > 0.5`) вычисленным `background-color`; иначе фон `body`, затем `html`, иначе белый.
  - `readSchemeSignals(doc: Document, win: Window): { colorScheme: string; metaScheme: string | null }`.
  - `placeholder.ts`: при загрузке синхронно добавляет в `document.documentElement` `<style data-darkext="placeholder">` с `html{background-color:#1e1e1e!important;color:#e0e0e0!important}`; при `__SYS__ === true` — внутри `@media (prefers-color-scheme: dark){…}`.
  - ```ts
    interface ControllerDeps {
      getConfig(): Promise<EffectiveConfig | null>; report(s: TabState): void;
      pipeline: Pipeline; matchDark(): { matches: boolean; onChange(cb: () => void): void };
      detect(): 'dark' | 'light' | 'unsure'; onDomReady(cb: () => void): void; onLoad(cb: () => void): void;
    }
    function createController(doc: Document, deps: ControllerDeps): { start(): Promise<void>; onConfig(cfg: EffectiveConfig | null): void; stop(): void };
    ```
    Логика: `start` → `getConfig` → `evaluate()`; `evaluate` = `shouldApply(cfg, { systemDark, pageIsDark })` → `apply` ? (`pipeline.start` при первом применении, иначе `update`) : `pipeline.detach()`; после первой оценки — удалить заглушку. Детектор: на DOM-ready — `pipeline.setDisabled(true)` → `detect()` → `setDisabled(false)` в одной синхронной задаче; `'unsure'` → повтор на `load`; `'dark'` → `pageIsDark = true` → `evaluate()`. Смена `matchDark` → `evaluate()`. После каждой оценки `report({ status, detectedDark })`, где `status` — `ApplyStatus` либо `pipeline.status()` (`error`/`heavy`), если применено и статус не `ok`. Если `cfg.ignoreDetection` — детектор не запускается.
  - `index.ts` связывает зависимости: `chrome.runtime.sendMessage` с одним повтором через 100 мс при ошибке соединения (service worker просыпается) и с перехватом «Extension context invalidated» → `controller.stop()` (отключает наблюдателей, страницу не трогает) и тихий выход; `pipeline.onStatus` → повторный `report`; `chrome.runtime.onMessage` `CONFIG_CHANGED` → `controller.onConfig`; события `darkext:shadow` (→ `pipeline.addRoot(host.shadowRoot)` если не `null`), `darkext:adopted` (→ пересканировать `adoptedStyleSheets` цели события), `darkext:sheet-changed` (на `<style>`/`<link>` → `pipeline.refreshSheet(el.sheet)`; на `document` → пересканировать `adoptedStyleSheets` документа и всех известных shadow root).

- [ ] **Step 1: Написать падающие тесты**

```ts
// controller.test.ts
function setup(over: Partial<ControllerDeps> = {}, cfgOver: Partial<EffectiveConfig> = {}) {
  const pipeline = { start: vi.fn(), update: vi.fn(), detach: vi.fn(), setDisabled: vi.fn(), status: () => 'ok', onStatus: vi.fn(), addRoot: vi.fn(), refreshSheet: vi.fn() } as unknown as Pipeline;
  let domReady = () => {}, load = () => {}, sysChange = () => {}; const sys = { matches: true };
  const deps: ControllerDeps = {
    getConfig: async () => ({ ...resolveConfig('a.com', DEFAULT_GLOBAL, undefined, []), ...cfgOver }),
    report: vi.fn(), pipeline, detect: vi.fn(() => 'light' as const),
    matchDark: () => ({ get matches() { return sys.matches; }, onChange: cb => { sysChange = cb; } }),
    onDomReady: cb => { domReady = cb; }, onLoad: cb => { load = cb; }, ...over,
  };
  document.documentElement.insertAdjacentHTML('beforeend', '<style data-darkext="placeholder"></style>');
  return { c: createController(document, deps), deps, pipeline, fire: { domReady: () => domReady(), load: () => load(), sys: (v: boolean) => { sys.matches = v; sysChange(); } } };
}
test('применяет и убирает заглушку', async () => {
  const { c, pipeline, deps } = setup(); await c.start();
  expect(pipeline.start).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-darkext=placeholder]')).toBeNull();
  expect(deps.report).toHaveBeenLastCalledWith({ status: 'active', detectedDark: false });
});
test('тёмная страница → detach, статус already-dark; детектор работает с отключёнными стилями', async () => {
  const { c, pipeline, deps, fire } = setup({ detect: vi.fn(() => 'dark' as const) }); await c.start(); fire.domReady();
  expect((pipeline.setDisabled as Mock).mock.calls).toEqual([[true], [false]]);
  expect(pipeline.detach).toHaveBeenCalled();
  expect(deps.report).toHaveBeenLastCalledWith({ status: 'already-dark', detectedDark: true });
});
test('unsure → повтор на load', async () => {
  const detect = vi.fn<[], 'dark' | 'light' | 'unsure'>().mockReturnValueOnce('unsure').mockReturnValueOnce('dark');
  const { c, fire, pipeline } = setup({ detect }); await c.start(); fire.domReady(); fire.load();
  expect(detect).toHaveBeenCalledTimes(2); expect(pipeline.detach).toHaveBeenCalled();
});
test('ignoreDetection → детектор не вызывается', async () => {
  const { c, fire, deps } = setup({}, { ignoreDetection: true }); await c.start(); fire.domReady();
  expect(deps.detect).not.toHaveBeenCalled();
});
test('followSystem: светлая система → detach; тёмная → снова start/update', async () => {
  const { c, fire, pipeline, deps } = setup({}, { followSystem: true }); await c.start();
  fire.sys(false); expect(pipeline.detach).toHaveBeenCalled();
  expect(deps.report).toHaveBeenLastCalledWith({ status: 'system-light', detectedDark: false });
  fire.sys(true); expect((pipeline.start as Mock).mock.calls.length + (pipeline.update as Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
});
test('getConfig → null (неподдерживаемая страница) → ничего не применяется, заглушка удалена', async () => {
  const { c, pipeline } = setup({ getConfig: async () => null }); await c.start();
  expect(pipeline.start).not.toHaveBeenCalled(); expect(document.querySelector('[data-darkext=placeholder]')).toBeNull();
});
// placeholder.test.ts
test('заглушка вставляет один <style data-darkext=placeholder>', async () => {
  await import('../placeholder/placeholder'); // __SYS__ = false через define в vitest.config.ts
  expect(document.querySelectorAll('[data-darkext=placeholder]').length).toBe(1);
});
```

- [ ] **Step 2: Run** `npx vitest run src/content src/placeholder` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `detector.ts`, `placeholder.ts`, `controller.ts`, `index.ts` по интерфейсам. `vitest.config.ts`: добавить `define: { __SYS__: 'false' }` и объявление `declare const __SYS__: boolean` в `src/placeholder/env.d.ts`.
- [ ] **Step 4: Run** `npx vitest run && npm run build` — Expected: PASS, сборка без ошибок.
- [ ] **Step 5: Коммит** `git add src src/placeholder vitest.config.ts && git commit -m "feat(content): controller with detection, system theme and placeholder"`

---

### Task 13: Общие UI-компоненты и popup

**Files:**
- Create: `src/ui/shared/components/{Segmented.tsx,Slider.tsx,StyleSelect.tsx}`, `src/ui/popup/{App.tsx,usePopupState.ts,popup.css}`, заменить `src/ui/popup/main.tsx`, тест `src/ui/popup/App.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `sendToBackground`, `PopupState`, `TabStatus` (Task 7); `PRESETS` (Task 3); `t` (Task 1); `resolveConfig` (Task 4).
- Produces:
  - `Segmented<T extends string>({ value, options: {value: T; label: string}[], onChange, ariaLabel })` — `role="radiogroup"`, кнопки `role="radio"` с `aria-checked`.
  - `Slider({ label, value, min, max, step = 1, onChange })` — `<input type=range>` с подписью и числом; `onChange` на каждое `input`.
  - `StyleSelect({ value, presets, userStyles, onChange })` — `<select>`, подписи пресетов через `t(nameKey)`; образцы цвета (`bg`, `text`, `accent`) рядом с выбранным стилем.
  - `usePopupState(): { state: PopupState | null; scope: 'global' | 'site'; setScope; updateGlobal(p: Partial<GlobalSettings>); updateSite(p: Patch<SiteSettings> | null) }` — `chrome.tabs.query({active:true,currentWindow:true})` → `GET_TAB_STATE`; обновления применяются оптимистично к локальному `state.snapshot` и отправляются `UPDATE_*` сразу (debounce делает service worker).
  - `App` — разметка §9.1 пункты 1, 2, 3, 5 (без «Изменить»), 6, 8 (без «Все настройки»). В области «Этот сайт» стиль и ползунки читают/пишут `site.st`/`site.adj`, кнопка «Сбросить к глобальным» → `updateSite({ st: null, adj: null })`. Переключатель «На этом сайте»: `default` → `{ on: null }`, `on` → `{ on: true }`, `off` → `{ on: false }`. Кнопка «Всё равно затемнить» → `{ det: true }`. При `status === 'unsupported'` показывается только шапка со статусом и подвал. При `status === 'error'` — кнопка `t('retry')` → `chrome.tabs.reload(tabId)`.

- [ ] **Step 1: Написать падающие тесты**

```tsx
// App.test.tsx
beforeEach(() => { installFakeChrome(); (chrome.i18n.getMessage as Mock).mockImplementation((k: string) => k); });
function mockState(p: Partial<PopupState> = {}) {
  (chrome.tabs.query as Mock).mockResolvedValue([{ id: 7, url: 'https://a.com/' }]);
  (chrome.runtime.sendMessage as Mock).mockImplementation(async (m: Request) =>
    m.type === 'GET_TAB_STATE' ? { host: 'a.com', state: { status: 'active', detectedDark: false }, snapshot: { g: DEFAULT_GLOBAL, styles: [], sites: {} }, ...p } : undefined);
}
test('переключатель «На этом сайте» → UPDATE_SITE {on:false}', async () => {
  mockState(); render(<App />); await userEvent.click(await screen.findByRole('radio', { name: 'siteOff' }));
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SITE', host: 'a.com', patch: { on: false } });
});
test('уже тёмный: баннер и «Всё равно затемнить» → {det:true}', async () => {
  mockState({ state: { status: 'already-dark', detectedDark: true } }); render(<App />);
  expect(await screen.findByText('alreadyDarkBanner')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'forceDarken' }));
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SITE', host: 'a.com', patch: { det: true } });
});
test('область «Этот сайт»: ползунок пишет site.adj; сброс удаляет st и adj', async () => {
  mockState(); render(<App />);
  await userEvent.click(await screen.findByRole('radio', { name: 'scopeSite' }));
  fireEvent.input(screen.getByLabelText('sliderBrightness'), { target: { value: '80' } });
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SITE', host: 'a.com', patch: { adj: { br: 80 } } });
  await userEvent.click(screen.getByRole('button', { name: 'resetToGlobal' }));
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SITE', host: 'a.com', patch: { st: null, adj: null } });
});
test('область «Глобально»: смена стиля → UPDATE_GLOBAL {st}', async () => {
  mockState(); render(<App />);
  await userEvent.selectOptions(await screen.findByLabelText('styleLabel'), 'oled');
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_GLOBAL', patch: { st: 'oled' } });
});
test('недоступная страница: только статус и подвал', async () => {
  mockState({ host: null, state: { status: 'unsupported', detectedDark: false } }); render(<App />);
  expect(await screen.findByText('statusUnsupported')).toBeInTheDocument();
  expect(screen.queryByLabelText('sliderBrightness')).toBeNull();
  expect(screen.getByRole('radio', { name: 'globalOff' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui` — Expected: FAIL.
- [ ] **Step 3: Реализовать** компоненты, хук и `App`. Стили `popup.css`: ширина 360 px, тёмная тема по умолчанию, светлая под `@media (prefers-color-scheme: light)`, цвета — CSS-переменные из стиля `graphite`.
- [ ] **Step 4: Run** `npx vitest run src/ui && npm run build` — Expected: PASS.
- [ ] **Step 5: Коммит** `git add src/ui && git commit -m "feat(ui): popup with site/global controls, style and sliders"`

---

### Task 14: Ручная проверка в браузере

**Files:** нет изменений кода, только исправления найденных дефектов (каждое — с регрессионным тестом в соответствующем модуле).

- [ ] **Step 1: Собрать** `npm run build`; загрузить `dist/` через `chrome://extensions` → «Режим разработчика» → «Загрузить распакованное».
- [ ] **Step 2: Проверить вручную и записать результат** (✅/❌ + заметка) в `docs/superpowers/plans/2026-11-07-plan-1-manual-check.md`:
  - Википедия, GitHub (светлая тема), Stack Overflow — страница тёмная, текст читаем, нет белой вспышки при переходах;
  - сайт с собственной тёмной темой (например, GitHub в тёмной теме) — не тронут, popup «Сайт уже тёмный»; «Всё равно затемнить» работает;
  - `Alt+Shift+D` и `Alt+Shift+G` переключают без перезагрузки; при `def: off` на невыбранных сайтах нет тёмного мелькания;
  - перетаскивание ползунка меняет страницу плавно; после закрытия popup значения сохранены;
  - переключение «Следовать системной теме» (через `chrome.storage.sync.set` в консоли service worker: `g.sys = true`) + смена темы Windows — тема включается/выключается на лету.
- [ ] **Step 3: Исправить найденные дефекты по одному** (сначала регрессионный тест, затем фикс), прогнать `npx vitest run`.
- [ ] **Step 4: Коммит** `git add -A && git commit -m "test: manual check of plan 1 + fixes"`

---

### Task 15: Сквозные тесты (Playwright)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/server.ts`, `tests/e2e/extension.ts`, `tests/e2e/fixtures/{light.html,vars.html,cross-origin.html,remote.css,dark.html,spa.html,shadow.html,css-in-js.html,iframe.html,frame-child.html}`, `tests/e2e/adaptive.spec.ts`

**Interfaces:**
- Consumes: собранный `dist/`.
- Produces:
  - `tests/e2e/server.ts`: статический сервер `tests/e2e/fixtures` на `127.0.0.1:4801` и `127.0.0.1:4802` (второй — источник `remote.css`), `globalSetup`/`globalTeardown` в конфиге.
  - `tests/e2e/extension.ts`: фикстура Playwright `{ context, sw, setSettings(items: Record<string, unknown>), bodyBg(page): Promise<number /* OKLCH L */> }` — `chromium.launchPersistentContext('', { channel: 'chromium', args: ['--disable-extensions-except=dist', '--load-extension=dist'] })`; `sw` — `context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')`; `setSettings` → `sw.evaluate(items => chrome.storage.sync.set(items), items)` и ожидание 600 мс (debounce + рассылка).

- [ ] **Step 1: Написать тесты** (`adaptive.spec.ts`, каждый — отдельный `test`):
  - `light.html`: `bodyBg < 0.3`; цвет текста абзаца `L > 0.75`; `img` без `filter`.
  - `vars.html` (`:root{--bg:#fff;--fg:#111} body{background:var(--bg);color:var(--fg)}`): `bodyBg < 0.3`, текст `L > 0.75`.
  - `cross-origin.html` (подключает `http://127.0.0.1:4802/remote.css` с `.box{background-color:#fff}`): фон `.box` `L < 0.3`.
  - `dark.html` (`body{background:#121212;color:#ddd}`): нет `[data-darkext=mirror]`, вычисленный фон `body` = `rgb(18, 18, 18)`.
  - `spa.html` (через 300 мс добавляет `<div class=late style="background:#fff">` и `<style>.late2{background-color:#fff}</style>`): через 1 с оба элемента `L < 0.3`.
  - `shadow.html` (кастомный элемент с открытым shadow root и `<style>:host div{background:#fff}</style>`, плюс `adoptedStyleSheets` с `.adopted{background:#fff}`): оба фона `L < 0.3`.
  - `css-in-js.html` (`sheet.insertRule('.dyn{background-color:#fff}')` через 300 мс): фон `.dyn` `L < 0.3` через 1 с.
  - `iframe.html` (iframe на `frame-child.html` того же origin со светлым фоном): фон внутри фрейма `L < 0.3`.
  - `def: 'off'`: `setSettings({ g: {...DEFAULT_GLOBAL, def: 'off'} })` → открыть `light.html` → `[data-darkext=placeholder]` отсутствует сразу после `domcontentloaded`, фон белый; затем `setSettings({ 's:127.0.0.1': { on: true } })` → фон тёмный без перезагрузки.
  - переключение на лету: `setSettings({ 's:127.0.0.1': { on: false } })` на открытой `light.html` → фон белый, `[data-darkext]` нет; `{ on: true }` → снова тёмный.

- [ ] **Step 2: Run** `npm run test:e2e` — Expected: тесты, зависящие от ещё не найденных дефектов, падают; остальные PASS.
- [ ] **Step 3: Исправить дефекты** (каждый — с модульным регрессионным тестом, если воспроизводим в jsdom).
- [ ] **Step 4: Run** `npx vitest run && npm run test:e2e` — Expected: всё PASS.
- [ ] **Step 5: Коммит** `git add -A && git commit -m "test(e2e): playwright suite for adaptive mode"`

---

## Определение готовности плана 1

- `npx vitest run`, `npm run typecheck`, `npm run test:e2e` — зелёные.
- Ручной чек-лист Task 14 — все пункты ✅ или с заведённым исправлением.
- Расширение из `dist/` затемняет сайты в режиме «Адаптивный» с настройками из popup.
