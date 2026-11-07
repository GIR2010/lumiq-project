import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
import { DEFAULT_GLOBAL } from '../../src/core/settings/defaults';
import { bgL, expect, test, textL } from './extension';
import { ORIGIN } from './server';

const DARK = 0.3;
const LIGHT_TEXT = 0.75;
/** "White": the page's own #fff background, untouched. */
const WHITE = 0.99;
const SITE = 's:127.0.0.1';

async function open(context: BrowserContext, name: string, waitUntil: 'load' | 'domcontentloaded' = 'load'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/${name}`, { waitUntil });
  return page;
}

/** The status the page's content script last reported to the service worker (popup/badge state). */
function tabStatus(sw: Worker, page: Page): Promise<string | undefined> {
  return sw.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
    if (tab?.id === undefined) return undefined;
    const key = `tab:${tab.id}`;
    const r = await chrome.storage.session.get(key);
    return (r[key] as { status?: string } | undefined)?.status;
  }, page.url());
}

test('light page: dark background, light text, images unfiltered', async ({ context, bodyBg }) => {
  const page = await open(context, 'light.html');
  await expect.poll(() => bodyBg(page)).toBeLessThan(DARK);
  await expect.poll(() => textL(page.locator('#text'))).toBeGreaterThan(LIGHT_TEXT);
  expect(await page.locator('#pic').evaluate((el) => getComputedStyle(el).filter)).toBe('none');
});

test('custom properties: background and text through var()', async ({ context, bodyBg }) => {
  const page = await open(context, 'vars.html');
  await expect.poll(() => bodyBg(page)).toBeLessThan(DARK);
  await expect.poll(() => textL(page.locator('#text'))).toBeGreaterThan(LIGHT_TEXT);
});

test('cross-origin stylesheet is fetched and mirrored', async ({ context }) => {
  const page = await open(context, 'cross-origin.html');
  await expect.poll(() => bgL(page.locator('#box'))).toBeLessThan(DARK);
});

test('already-dark page is left alone', async ({ context, sw }) => {
  const page = await open(context, 'dark.html');
  await expect.poll(() => tabStatus(sw, page)).toBe('already-dark');
  await expect(page.locator('[data-darkext=mirror]')).toHaveCount(0);
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(18, 18, 18)');
});

test('SPA: elements and styles added later are darkened', async ({ context }) => {
  const page = await open(context, 'spa.html');
  await page.locator('.late2').waitFor({ state: 'attached' });
  await expect.poll(() => bgL(page.locator('.late')), { timeout: 1000 }).toBeLessThan(DARK);
  await expect.poll(() => bgL(page.locator('.late2')), { timeout: 1000 }).toBeLessThan(DARK);
});

test('shadow DOM styles and adopted stylesheets are darkened', async ({ context }) => {
  const page = await open(context, 'shadow.html');
  await expect.poll(() => bgL(page.locator('x-card .inner'))).toBeLessThan(DARK);
  await expect.poll(() => bgL(page.locator('#adopted'))).toBeLessThan(DARK);
});

test('CSS-in-JS: a rule inserted with insertRule is darkened', async ({ context }) => {
  const page = await open(context, 'css-in-js.html');
  await page.waitForFunction(() => (document.getElementById('runtime') as HTMLStyleElement).sheet!.cssRules.length > 0);
  await expect.poll(() => bgL(page.locator('#dyn')), { timeout: 1000 }).toBeLessThan(DARK);
});

test('same-origin iframe is darkened', async ({ context, bodyBg }) => {
  const page = await open(context, 'iframe.html');
  await expect.poll(() => bodyBg(page)).toBeLessThan(DARK);
  await expect.poll(() => bgL(page.frameLocator('#child').locator('body'))).toBeLessThan(DARK);
});

/** Records a placeholder appearing at any time from document start (a dark flash), in every page of the context. */
async function recordPlaceholder(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __placeholderSeen: boolean };
    const seen = () => !!document.querySelector('[data-darkext=placeholder]');
    w.__placeholderSeen = seen();
    new MutationObserver(() => { if (seen()) w.__placeholderSeen = true; })
      .observe(document, { childList: true, subtree: true });
  });
}
const placeholderSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __placeholderSeen: boolean }).__placeholderSeen);

test("def: 'off': no dark flash; enabling the site darkens it without a reload", async ({ context, setSettings, bodyBg }) => {
  await setSettings({ g: { ...DEFAULT_GLOBAL, def: 'off' } });
  await recordPlaceholder(context);
  const page = await open(context, 'light.html', 'domcontentloaded');
  await expect(page.locator('[data-darkext=placeholder]')).toHaveCount(0);
  expect(await placeholderSeen(page)).toBe(false);
  expect(await bgL(page.locator('html'))).toBeGreaterThan(WHITE);
  expect(await bodyBg(page)).toBeGreaterThan(WHITE);

  await setSettings({ [SITE]: { on: true } });
  await expect.poll(() => bodyBg(page)).toBeLessThan(DARK);
});

test('toggling the site on the fly', async ({ context, setSettings, bodyBg }) => {
  const page = await open(context, 'light.html');
  await expect.poll(() => bodyBg(page)).toBeLessThan(DARK);

  await setSettings({ [SITE]: { on: false } });
  await expect.poll(() => bodyBg(page)).toBeGreaterThan(WHITE);
  await expect(page.locator('[data-darkext]')).toHaveCount(0);

  await setSettings({ [SITE]: { on: true } });
  await expect.poll(() => bodyBg(page)).toBeLessThan(DARK);
});

// Regression (found by this suite): the site key of an IP host must give valid placeholder match patterns.
test('placeholder registration follows per-site settings of an IP host', async ({ context, setSettings }) => {
  await recordPlaceholder(context);
  await setSettings({ [SITE]: { on: false } });
  const off = await open(context, 'light.html', 'domcontentloaded');
  expect(await placeholderSeen(off)).toBe(false);
  expect(await bgL(off.locator('html'))).toBeGreaterThan(WHITE);

  await setSettings({ g: { ...DEFAULT_GLOBAL, def: 'off' }, [SITE]: { on: true } });
  const on = await open(context, 'light.html', 'domcontentloaded');
  expect(await placeholderSeen(on)).toBe(true);
});

// --- final review fixes ---

test('custom properties defined in an earlier (cross-origin) sheet than the one using them', async ({ context, bodyBg }) => {
  const page = await open(context, 'vars-split.html');
  await expect.poll(() => bodyBg(page)).toBeLessThan(DARK);
  await expect.poll(() => textL(page.locator('#text'))).toBeGreaterThan(LIGHT_TEXT);
});

test('CSS-in-JS: 5 000 rules inserted over several frames end up dark', async ({ context, sw }) => {
  const page = await open(context, 'css-in-js-heavy.html');
  await page.waitForFunction(() => document.body.dataset.done === '1');
  await expect.poll(() => bgL(page.locator('#last')), { timeout: 3000 }).toBeLessThan(DARK);
  await expect.poll(() => bgL(page.locator('#first')), { timeout: 3000 }).toBeLessThan(DARK);
  expect(await tabStatus(sw, page)).not.toBe('heavy');
});

test('CSS from a slow CDN: the body is never light between DOMContentLoaded and the mirror', async ({ context, bodyBg }) => {
  await context.addInitScript(() => {
    const w = window as unknown as { __flash: { light: boolean; mirrored: boolean; frames: number } };
    w.__flash = { light: false, mirrored: false, frames: 0 };
    const isLight = (css: string) => {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(css);
      return !!m && (m[4] === undefined || Number(m[4]) > 0.5) && Number(m[1]) + Number(m[2]) + Number(m[3]) > 600;
    };
    document.addEventListener('DOMContentLoaded', () => {
      const tick = () => {
        const link = document.querySelector('link[rel=stylesheet]');
        const mirrored = link?.nextElementSibling?.getAttribute('data-darkext') === 'mirror';
        if (isLight(getComputedStyle(document.body).backgroundColor)) w.__flash.light = true;
        if (mirrored) w.__flash.mirrored = true;
        if (w.__flash.mirrored && ++w.__flash.frames > 5) return;
        requestAnimationFrame(tick);
      };
      tick();
    });
  });
  const page = await open(context, 'cdn.html', 'domcontentloaded');
  await page.waitForFunction(() => (window as unknown as { __flash: { frames: number } }).__flash.frames > 5, null, { timeout: 5000 });
  expect(await page.evaluate(() => (window as unknown as { __flash: { light: boolean } }).__flash.light)).toBe(false);
  expect(await bodyBg(page)).toBeLessThan(DARK);
});

test('a constructed sheet shared by two shadow roots is mirrored into both; turning off cleans both', async ({ context, setSettings }) => {
  const page = await open(context, 'shared-sheet.html');
  await expect.poll(() => bgL(page.locator('x-a .inner'))).toBeLessThan(DARK);
  await expect.poll(() => bgL(page.locator('x-b .inner'))).toBeLessThan(DARK);
  await setSettings({ [SITE]: { on: false } });
  await expect.poll(() => bgL(page.locator('x-a .inner'))).toBeGreaterThan(WHITE);
  const counts = await page.evaluate(() => ['x-a', 'x-b'].map((t) => document.querySelector(t)!.shadowRoot!.adoptedStyleSheets.length));
  expect(counts).toEqual([1, 1]);
});

test('repeated settings changes do not make a later stylesheet "heavy"', async ({ context, sw, setSettings, bodyBg }) => {
  const page = await open(context, 'light.html');
  await expect.poll(() => bodyBg(page)).toBeLessThan(DARK);
  for (const br of [90, 110, 95, 105, 100]) await setSettings({ g: { ...DEFAULT_GLOBAL, adj: { ...DEFAULT_GLOBAL.adj, br } } });
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.later{background-color:#fff}';
    document.head.append(style);
    document.body.insertAdjacentHTML('beforeend', '<div class="later" id="later">Added after the settings changes.</div>');
  });
  await expect.poll(() => bgL(page.locator('#later'))).toBeLessThan(DARK);
  expect(await tabStatus(sw, page)).not.toBe('heavy');
});

test('var() inside shorthands and color-mix() are darkened (translate.google.com patterns)', async ({ context }) => {
  const page = await open(context, 'var-shorthand.html');
  await expect.poll(() => bgL(page.locator('#bar'))).toBeLessThan(DARK);
  // The fade gradient must no longer end in white.
  await expect.poll(() => page.locator('#nav').evaluate((el) => getComputedStyle(el, '::after').backgroundImage))
    .not.toContain('rgb(255, 255, 255)');
  await expect.poll(() => page.locator('#box').evaluate((el) => getComputedStyle(el).borderTopColor))
    .not.toBe('rgb(204, 204, 204)');
  await expect.poll(() => textL(page.locator('#label'))).toBeGreaterThan(0.6);
});

// --- stage 1.5a: colours and variables ---

interface Swatch { r: number; g: number; b: number; L: number; C: number }
/** An element's computed colour (normalised to 8-bit sRGB through a canvas) with OKLCH lightness and chroma. */
function swatch(locator: Locator, prop: 'color' | 'backgroundColor' | 'borderTopColor'): Promise<Swatch> {
  return locator.evaluate((el: Element, p: string) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    ctx.canvas.width = ctx.canvas.height = 1;
    ctx.fillStyle = '#000';
    ctx.fillStyle = (getComputedStyle(el) as unknown as Record<string, string>)[p];
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const [R, G, B] = [r, g, b].map(lin);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { r, g, b, L, C: Math.hypot(a, bb) };
  }, prop);
}
const luminance = (c: Swatch) => {
  const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const contrast = (a: Swatch, b: Swatch) => {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

test('Tailwind opacity channels: rgb(... / var(--tw-*-opacity)) is darkened', async ({ context }) => {
  const page = await open(context, 'tailwind.html');
  await expect.poll(() => bgL(page.locator('.t'))).toBeLessThan(DARK);
  await expect.poll(() => textL(page.locator('.x'))).toBeGreaterThan(0.6);
});

test('variable stacks: white as text and background, saturated circles, mixed uses', async ({ context }) => {
  const page = await open(context, 'stacks.html');
  await expect.poll(() => bgL(page.locator('#white'))).toBeLessThan(DARK);
  await expect.poll(() => textL(page.locator('#has'))).toBeGreaterThan(0.5);
  // The circle stays saturated and the white icon on it stays readable.
  await expect.poll(async () => {
    const bg = await swatch(page.locator('#circle'), 'backgroundColor');
    const fg = await swatch(page.locator('#icon'), 'color');
    return contrast(fg, bg) >= 4.5 && bg.C >= 0.1 && bg.L >= 0.25 && bg.L <= 0.65;
  }).toBe(true);
  const circle = await swatch(page.locator('#circle'), 'backgroundColor');
  expect(circle.C).toBeGreaterThanOrEqual(0.1);
  expect(circle.L).toBeGreaterThanOrEqual(0.25);
  expect(circle.L).toBeLessThanOrEqual(0.65);
  expect(contrast(await swatch(page.locator('#icon'), 'color'), circle)).toBeGreaterThanOrEqual(4.5);
  // The variable used as both text colour and border colour stays readable.
  expect((await swatch(page.locator('#has'), 'color')).L).toBeGreaterThan(0.5);
});

test('pagination: white text on an orange variable background keeps both readable', async ({ context }) => {
  const page = await open(context, 'stacks.html');
  await expect.poll(() => bgL(page.locator('#white'))).toBeLessThan(DARK); // extension has run
  const bg = await swatch(page.locator('#sel'), 'backgroundColor');
  const fg = await swatch(page.locator('#sel'), 'color');
  // Spec 3.11: a saturated bg is clamped to L 0.65, so white on #f48225 lands near 3.4 (the original site is ~2.9);
  // pair-contrast protection is deferred to plan 2. 3.0 is the acceptance scanner's unreadable threshold.
  expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3.0);
  expect(bg.C).toBeGreaterThanOrEqual(0.1);
  expect(bg.L).toBeGreaterThanOrEqual(0.25);
  expect(bg.L).toBeLessThanOrEqual(0.65);
});

test('inline custom property chained to a root variable reaches an svg icon', async ({ context }) => {
  const page = await open(context, 'chain-inline.html');
  await expect.poll(() => textL(page.locator('#ico'))).toBeGreaterThan(0.6);
});

test('mask icons: the masked element background is lightened with the text colour', async ({ context }) => {
  const page = await open(context, 'mask-icons.html');
  await expect.poll(() => bgL(page.locator('#ic'))).toBeGreaterThan(0.6);
});

test('a hidden ::-webkit-scrollbar row gets no scrollbar height with the theme on', async ({ context, bodyBg }) => {
  const page = await open(context, 'scrollbar-hidden.html');
  await expect.poll(() => bodyBg(page)).toBeLessThan(DARK);
  expect(await page.locator('#row').evaluate((el) => (el as HTMLElement).offsetHeight - el.clientHeight)).toBe(0);
});

// --- stage 1.5b: dark icon images ---

const cssOf = (page: Page, sel: string, prop: 'backgroundImage' | 'listStyleImage') =>
  page.locator(sel).evaluate((el, p) => getComputedStyle(el)[p], prop);
const iconMark = (page: Page, sel: string) => page.locator(sel).getAttribute('data-darkext-icon');

test('dark icon images: CSS sprite and list marker get inverted copies, dark <img> are marked', async ({ context }) => {
  const page = await open(context, 'icons.html');
  await expect.poll(() => cssOf(page, '#ic', 'backgroundImage')).toContain('data:image/png');
  await expect.poll(() => cssOf(page, '#arrows', 'listStyleImage')).toContain('data:');
  await expect.poll(() => iconMark(page, '#text')).not.toBeNull();
  // Review focus #1: an SVG without width/height and a currentColor (black) glyph.
  await expect.poll(() => iconMark(page, '#nosize')).not.toBeNull();
});

test('light coloured logo, photo and animated GIF are left as they are', async ({ context }) => {
  const page = await open(context, 'icons.html');
  // Positive control: analysis has run on the page.
  await expect.poll(() => cssOf(page, '#ic', 'backgroundImage')).toContain('data:image/png');
  await expect.poll(() => iconMark(page, '#nosize')).not.toBeNull();
  // Every image is requested at once (≤ 4 at a time): give the rest time to finish.
  await page.waitForTimeout(1500);
  expect(await iconMark(page, '#logo')).toBeNull();
  expect(await iconMark(page, '#photo-img')).toBeNull();
  expect(await cssOf(page, '#photo', 'backgroundImage')).toMatch(/^url\("http:[^"]*photo\.png"\)$/);
  expect(await cssOf(page, '#anim', 'backgroundImage')).toMatch(/^url\("http:[^"]*anim\.gif"\)$/);
  // The same animated GIF is a dark icon: as an <img> it gets the filter, only the CSS swap is skipped.
  await expect.poll(() => iconMark(page, '#anim-img')).not.toBeNull();
});

test('turning the site off removes icon marks and inverted copies', async ({ context, setSettings }) => {
  const page = await open(context, 'icons.html');
  await expect.poll(() => cssOf(page, '#ic', 'backgroundImage')).toContain('data:image/png');
  await expect.poll(() => iconMark(page, '#text')).not.toBeNull();

  await setSettings({ [SITE]: { on: false } });
  await expect(page.locator('[data-darkext-icon]')).toHaveCount(0);
  expect(await cssOf(page, '#ic', 'backgroundImage')).toMatch(/^url\("http:[^"]*dark-glyph\.png"\)$/);
});

/** Pixels of an element screenshot that differ from its top-left (background) pixel by more than `min` in a channel. */
async function inkPixels(context: BrowserContext, png: Buffer, min = 8): Promise<number> {
  const scratch = await context.newPage();
  try {
    return await scratch.evaluate(async ([b64, m]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.canvas.width = img.naturalWidth;
      ctx.canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data;
      let n = 0;
      for (let p = 0; p < d.length; p += 4) {
        if (Math.max(Math.abs(d[p] - d[0]), Math.abs(d[p + 1] - d[1]), Math.abs(d[p + 2] - d[2])) > (m as number)) n++;
      }
      return n;
    }, [png.toString('base64'), min] as const);
  } finally {
    await scratch.close();
  }
}

test('CSP img-src without data: — the CSS icon is never blank (swapped and painted, or left original)', async ({ context }) => {
  const page = await open(context, 'icons-csp.html');
  // The <img> path (a CSS filter) is unaffected by the policy; the content script still decodes data: images.
  await expect.poll(() => iconMark(page, '#text')).not.toBeNull();
  await page.waitForTimeout(1500); // the sprite's analysis and swap attempt are done by now
  const dataBlocked = () => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations.some((v) => / data/.test(v)));
  await expect.poll(async () => {
    const bg = await cssOf(page, '#ic', 'backgroundImage');
    if (bg.startsWith('url("data:')) {
      // Swapped: only acceptable if the copy is allowed to render (light glyph on the dark page).
      return !(await dataBlocked()) && (await inkPixels(context, await page.locator('#ic').screenshot())) > 20 ? 'swapped' : 'blank';
    }
    // Left as the original sprite: it paints (dark on dark, but there).
    return /dark-glyph\.png/.test(bg) && (await inkPixels(context, await page.locator('#ic').screenshot(), 0)) > 20 ? 'original' : 'blank';
  }).not.toBe('blank');
  // Chromium 2026: data: is blocked here, so the swap is withdrawn and the variables style removed.
  if (await dataBlocked()) await expect(page.locator('style[data-darkext=icon-vars]')).toHaveCount(0);
});
