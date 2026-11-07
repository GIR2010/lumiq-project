import { collectVarUsage, type VarLinks, type VarRoleCounter } from '../../core/css/vars';
import { SHORTHAND_ROLES } from '../../core/css/declarations';

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
export function parseCssText(text: string): CSSRuleList {
  const doc = document.implementation.createHTMLDocument('');
  const style = doc.createElement('style');
  style.textContent = text;
  doc.head.appendChild(style);
  if (style.sheet) return style.sheet.cssRules;
  // Fallback for environments without a browsing context for detached documents (e.g. jsdom).
  const sheet = new CSSStyleSheet();
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
