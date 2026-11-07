import { collectVarUsage, type VarLinks, type VarRoleCounter } from '../../core/css/vars';
import { SHORTHAND_ROLES } from '../../core/css/declarations';
import { IMAGE_PROPS, singleImageUrl } from '../../core/css/image-urls';

export function readRules(sheet: CSSStyleSheet): CSSRuleList | 'cross-origin' | 'pending' {
  try {
    const rules = sheet.cssRules;
    return rules ?? 'pending';
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'SecurityError') return 'cross-origin';
    return 'pending';
  }
}

/** Parses CSS text in a detached document, so the page is unaffected. */
/** Parses detached CSS; `baseUrl` (the file's URL) is the base its relative URLs resolve against. */
export function parseCssText(text: string, baseUrl?: string): CSSRuleList {
  const doc = document.implementation.createHTMLDocument('');
  if (baseUrl) {
    const base = doc.createElement('base');
    base.href = baseUrl;
    doc.head.appendChild(base);
  }
  const style = doc.createElement('style');
  style.textContent = text;
  doc.head.appendChild(style);
  if (style.sheet) return style.sheet.cssRules;
  // Fallback for environments without a browsing context for detached documents (e.g. jsdom).
  const sheet = new CSSStyleSheet(baseUrl ? { baseURL: baseUrl } : undefined);
  sheet.replaceSync(text);
  return sheet.cssRules;
}

export function extractImports(text: string, baseUrl: string): string[] {
  const out: string[] = [];
  const re = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    if (!raw) continue;
    try {
      out.push(new URL(raw, baseUrl).href);
    } catch {
      /* ignore malformed URL */
    }
  }
  return out;
}

export function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return typeof (rule as CSSStyleRule).selectorText === 'string' && !!(rule as CSSStyleRule).style;
}

/** Grouping at-rules (media/supports/layer/container) expose nested cssRules. */
export function isGroupingRule(rule: CSSRule): rule is CSSGroupingRule {
  return !isStyleRule(rule) && !!(rule as CSSGroupingRule).cssRules;
}

/** Everything before the opening brace of a rule's cssText, e.g. `@media (min-width: 1px)`. */
export function ruleHeader(rule: CSSRule): string {
  const t = rule.cssText;
  return t.slice(0, t.indexOf('{')).trim();
}

/**
 * Colour shorthands declared with var(): Chrome leaves these unexpanded (their longhands read as
 * empty), so they must be read and mirrored as shorthands.
 */
export function varShorthands(st: CSSStyleDeclaration): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const prop of Object.keys(SHORTHAND_ROLES)) {
    const value = st.getPropertyValue(prop);
    if (value && value.toLowerCase().includes('var(')) out.push([prop, value]);
  }
  return out;
}

const MASK_TEXT_PROPS = new Set(['background-color', 'background']);

/**
 * Whether the block declares a background colour (longhand or shorthand, var() shorthands included).
 * Only such rules can be mask rules, so the (costly) mask lookup is skipped for the rest.
 */
export function declaresBackground(st: CSSStyleDeclaration): boolean {
  return !!(st.getPropertyValue('background-color') || st.getPropertyValue('background'));
}

function countOne(prop: string, value: string, counter: VarRoleCounter, links: VarLinks | undefined, asMask: boolean): void {
  if (asMask && MASK_TEXT_PROPS.has(prop)) {
    // A mask paints with background-color, so these usages are icon (text) colours.
    for (const m of value.matchAll(/var\(\s*(--[^\s,)]+)/gi)) counter.add(m[1], 'text');
    return;
  }
  collectVarUsage(prop, value, counter, links);
}

/**
 * Counts `var()` usages of one declaration block by role; custom properties it defines are added to
 * `defs` and their var() references to `links`. With `asMask`, background colour usages count as text.
 */
export function countStyleDeclaration(
  st: CSSStyleDeclaration,
  counter: VarRoleCounter,
  links?: VarLinks,
  defs?: Set<string>,
  asMask = false,
): void {
  for (let i = 0; i < st.length; i++) {
    const prop = st.item(i);
    if (defs && prop.startsWith('--')) defs.add(prop);
    countOne(prop, st.getPropertyValue(prop), counter, links, asMask);
  }
  for (const [prop, value] of varShorthands(st)) countOne(prop, value, counter, links, asMask);
}

/** Counts `var()` usages by role; custom properties the rules define are added to `defs`. */
export function countVarUsage(
  rules: CSSRuleList,
  counter: VarRoleCounter,
  defs?: Set<string>,
  links?: VarLinks,
  isMask?: (selector: string) => boolean,
): void {
  for (const rule of Array.from(rules)) {
    if (isStyleRule(rule)) {
      const asMask = !!isMask && declaresBackground(rule.style) && isMask(rule.selectorText);
      countStyleDeclaration(rule.style, counter, links, defs, asMask);
    } else if (isGroupingRule(rule)) {
      countVarUsage(rule.cssRules, counter, defs, links, isMask);
    }
  }
}

/** One swappable image url() found in a declaration block. */
export interface ImageDecl {
  /** Property to emit in the mirror (shorthands map to their image longhand). */
  outProp: string;
  /** Raw url text as written in the declaration. */
  raw: string;
  /** Absolute URL: the key for icon lookups. */
  abs: string;
  /** Full declared value. */
  value: string;
  important: boolean;
  /** The url was found in a shorthand (other parts of the value must not be re-emitted). */
  shorthand: boolean;
}

const IMAGE_LONGHAND: Record<string, string> = { background: 'background-image', 'list-style': 'list-style-image' };

/** Base URL for resolving relative urls of a rule: its sheet's href, else the owner document's base. */
export function ruleBase(rule: CSSRule): string {
  const sheet = rule.parentStyleSheet;
  if (sheet?.href) return sheet.href;
  const owner = (sheet?.ownerNode as Node | null | undefined)?.ownerDocument;
  return owner?.baseURI ?? document.baseURI;
}

/** Single-url image declarations of a block; a shorthand is skipped when its image longhand is set. */
export function imageDecls(st: CSSStyleDeclaration, base: string): ImageDecl[] {
  const out: ImageDecl[] = [];
  for (const prop of IMAGE_PROPS) {
    const outProp = IMAGE_LONGHAND[prop] ?? prop;
    const shorthand = outProp !== prop;
    if (shorthand && st.getPropertyValue(outProp)) continue;
    const value = st.getPropertyValue(prop);
    if (!value) continue;
    const raw = singleImageUrl(prop, value);
    if (raw === null) continue;
    let abs: string;
    try {
      abs = new URL(raw, base).href;
    } catch {
      continue;
    }
    out.push({ outProp, raw, abs, value, important: st.getPropertyPriority(prop) === 'important', shorthand });
  }
  return out;
}

/** Absolute URLs of single-image declarations (nested grouping rules included), de-duplicated. */
export function collectImageUrls(rules: CSSRuleList, base: string): string[] {
  const found = new Set<string>();
  const walk = (list: CSSRuleList): void => {
    for (const rule of Array.from(list)) {
      if (isStyleRule(rule)) for (const d of imageDecls(rule.style, base)) found.add(d.abs);
      else if (isGroupingRule(rule)) walk(rule.cssRules);
    }
  };
  walk(rules);
  return [...found];
}
