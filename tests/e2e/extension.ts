import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, type BrowserContext, type Locator, type Page, type Worker } from '@playwright/test';

const DIST = resolve(fileURLToPath(import.meta.url), '../../../dist');
/** Store debounce (500 ms) plus the broadcast to tabs. */
const SETTLE_MS = 600;

type ColorProp = 'backgroundColor' | 'color';

/**
 * OKLCH lightness of an element's colour, computed in the page. For backgrounds the first ancestor
 * (crossing shadow boundaries) with an opaque-enough background counts, else the white canvas.
 * Any CSS colour syntax is normalised to 8-bit sRGB through a canvas.
 */
function lightnessOf(locator: Locator, prop: ColorProp): Promise<number> {
  return locator.evaluate((el: Element, p: ColorProp) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    ctx.canvas.width = ctx.canvas.height = 1;
    const rgba = (css: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    };
    const resolveRgb = (start: Element): number[] => {
      if (p === 'color') return rgba(getComputedStyle(start).color);
      for (let n: Element | null = start; n; n = n.parentElement ?? ((n.getRootNode() as ShadowRoot).host ?? null)) {
        const c = rgba(getComputedStyle(n).backgroundColor);
        if (c[3] > 127) return c;
      }
      return [255, 255, 255, 255];
    };
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const [r, g, b] = resolveRgb(el).map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  }, prop);
}

export const bgL = (locator: Locator) => lightnessOf(locator, 'backgroundColor');
export const textL = (locator: Locator) => lightnessOf(locator, 'color');

export interface ExtensionFixtures {
  context: BrowserContext;
  sw: Worker;
  /** Writes items to chrome.storage.sync from the service worker and waits for them to reach the tabs. */
  setSettings(items: Record<string, unknown>): Promise<void>;
  /** OKLCH L of the body's (effective) background. */
  bodyBg(page: Page): Promise<number>;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await use(sw);
  },
  setSettings: async ({ sw }, use) => {
    await use(async (items) => {
      await sw.evaluate((i) => chrome.storage.sync.set(i), items);
      await new Promise((r) => setTimeout(r, SETTLE_MS));
    });
  },
  bodyBg: async ({}, use) => {
    await use((page) => bgL(page.locator('body')));
  },
});

export { expect } from '@playwright/test';
