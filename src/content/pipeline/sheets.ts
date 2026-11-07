import { collectVarUsage, type VarRoleCounter } from '../../core/css/vars';

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

/** Counts `var()` usages by role; custom properties the rules define are added to `defs`. */
export function countVarUsage(rules: CSSRuleList, counter: VarRoleCounter, defs?: Set<string>): void {
  for (const rule of Array.from(rules)) {
    if (isStyleRule(rule)) {
      const st = rule.style;
      for (let i = 0; i < st.length; i++) {
        const prop = st.item(i);
        if (defs && prop.startsWith('--')) defs.add(prop);
        collectVarUsage(prop, st.getPropertyValue(prop), counter);
      }
    } else if (isGroupingRule(rule)) {
      countVarUsage(rule.cssRules, counter, defs);
    }
  }
}
