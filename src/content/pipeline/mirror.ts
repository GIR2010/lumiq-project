import { parseColor } from '../../core/color';
import { isLinkSelector, mapDeclarationValue, mapValueWithRole } from '../../core/css/declarations';
import type { VarRoles } from '../../core/css/vars';
import type { ColorFn, RuleContext } from '../../core/mapping/types';
import { isGroupingRule, isStyleRule, ruleHeader } from './sheets';

function styleRuleCss(rule: CSSStyleRule, fn: ColorFn, vars: VarRoles): string {
  const st = rule.style;
  const selector = rule.selectorText;
  const bg = st.getPropertyValue('background-color');
  const link = isLinkSelector(selector);
  const ctx: RuleContext = { selector, ...link, pairedBg: (bg && parseColor(bg)) || undefined };
  let body = '';
  for (let i = 0; i < st.length; i++) {
    const prop = st.item(i);
    const value = st.getPropertyValue(prop);
    const mapped = prop.startsWith('--')
      ? mapValueWithRole(value, vars.roleOf(prop), fn, ctx)
      : mapDeclarationValue(prop, value, fn, ctx);
    if (mapped === null) continue;
    const imp = st.getPropertyPriority(prop) === 'important' ? ' !important' : '';
    body += `${prop}:${mapped}${imp};`;
  }
  return body ? `${selector}{${body}}` : '';
}

export function buildMirrorCss(rules: CSSRuleList, fn: ColorFn, vars: VarRoles): string {
  let out = '';
  for (const rule of Array.from(rules)) {
    if (isStyleRule(rule)) {
      out += styleRuleCss(rule, fn, vars);
    } else if (isGroupingRule(rule)) {
      const inner = buildMirrorCss(rule.cssRules, fn, vars);
      if (inner) out += `${ruleHeader(rule)}{${inner}}`;
    }
  }
  return out;
}
