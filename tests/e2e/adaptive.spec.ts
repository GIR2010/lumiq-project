import type { BrowserContext, Page, Worker } from '@playwright/test';
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
