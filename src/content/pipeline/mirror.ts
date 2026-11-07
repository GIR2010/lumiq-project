import { parseColor } from '../../core/color';
import { isLinkSelector, mapDeclarationValue, mapValueWithRole, rewriteVarUses, twinName } from '../../core/css/declarations';
import type { VarRoles } from '../../core/css/vars';
import type { ColorFn, Role, RuleContext } from '../../core/mapping/types';
import { replaceImageUrl } from '../../core/css/image-urls';
import { declaresBackground, imageDecls, isGroupingRule, isStyleRule, ruleBase, ruleHeader, varShorthands } from './sheets';

/** URL → inverted data: copy, when the image is a dark icon. */
export type IconLookup = (url: string) => string | undefined;

const MASK_TEXT_PROPS = new Set(['background-color', 'background']);
/** Colour and CSS-wide keywords: an override with one of these must shadow the inherited twins too. */
const TWIN_KEYWORDS = /^(?:transparent|currentcolor|inherit|initial|unset|revert|revert-layer)$/i;

function recolorAndRewrite(value: string, role: Role, fn: ColorFn, ctx: RuleContext, vars: VarRoles, prop = ''): string | null {
  const mapped = mapValueWithRole(value, role, fn, ctx, prop);
  const rewritten = rewriteVarUses(mapped ?? value, role, (n) => vars.isMixed(n));
  return rewritten ?? mapped;
}

/** Declarations (main value and, for mixed variables, per-role twins) for a custom property. */
function customPropCss(prop: string, value: string, imp: string, fn: ColorFn, ctx: RuleContext, vars: VarRoles): string {
  let out = '';
  const main = recolorAndRewrite(value, vars.roleOf(prop), fn, ctx, vars);
  if (main !== null) out += `${prop}:${main}${imp};`;
  if (!vars.isMixed(prop)) return out;
  const always = /var\(/i.test(value) || TWIN_KEYWORDS.test(value.trim());
  for (const role of vars.rolesOf(prop)) {
    const recolored = mapValueWithRole(value, role, fn, ctx);
    if (recolored === null && !always) continue;
    const twin = recolorAndRewrite(value, role, fn, ctx, vars) ?? value;
    out += `${twinName(prop, role)}:${twin}${imp};`;
  }
  return out;
}

function styleRuleCss(rule: CSSStyleRule, fn: ColorFn, vars: VarRoles, isMask?: (selector: string) => boolean, icons?: IconLookup): string {
  const st = rule.style;
  const selector = rule.selectorText;
  const bg = st.getPropertyValue('background-color');
  const link = isLinkSelector(selector);
  const asMask = !!isMask && declaresBackground(st) && isMask(selector);
  const ctx: RuleContext = { selector, ...link, pairedBg: (bg && parseColor(bg)) || undefined,
    // Closures: the table's methods rely on `this`, but consumers call them detached.
    vars: { roleOf: (n) => vars.roleOf(n), isMixed: (n) => vars.isMixed(n) } };
  const mapProp = (prop: string, value: string): string | null =>
    asMask && MASK_TEXT_PROPS.has(prop)
      ? recolorAndRewrite(value, 'text', fn, ctx, vars, prop)
      : mapDeclarationValue(prop, value, fn, ctx);
  let body = '';
  for (const [prop, value] of varShorthands(st)) {
    const mapped = mapProp(prop, value);
    if (mapped === null) continue;
    const imp = st.getPropertyPriority(prop) === 'important' ? ' !important' : '';
    body += `${prop}:${mapped}${imp};`;
  }
  for (let i = 0; i < st.length; i++) {
    const prop = st.item(i);
    const value = st.getPropertyValue(prop);
    const imp = st.getPropertyPriority(prop) === 'important' ? ' !important' : '';
    if (prop.startsWith('--')) {
      body += customPropCss(prop, value, imp, fn, ctx, vars);
      continue;
    }
    const mapped = mapProp(prop, value);
    if (mapped === null) continue;
    body += `${prop}:${mapped}${imp};`;
  }
  if (icons) {
    for (const d of imageDecls(st, ruleBase(rule))) {
      const copy = icons(d.abs);
      if (!copy) continue;
      // A shorthand is never re-emitted (it would reset colours the mirror sets): only its image longhand.
      const value = replaceImageUrl(d.shorthand ? `url("${d.raw.replace(/[\\"]/g, '\$&')}")` : d.value, d.raw, copy);
      body += `${d.outProp}:${value}${d.important ? ' !important' : ''};`;
    }
  }
  return body ? `${selector}{${body}}` : '';
}

export function buildMirrorCss(rules: CSSRuleList, fn: ColorFn, vars: VarRoles, isMask?: (selector: string) => boolean, icons?: IconLookup): string {
  let out = '';
  for (const rule of Array.from(rules)) {
    if (isStyleRule(rule)) {
      out += styleRuleCss(rule, fn, vars, isMask, icons);
    } else if (isGroupingRule(rule)) {
      const inner = buildMirrorCss(rule.cssRules, fn, vars, isMask, icons);
      if (inner) out += `${ruleHeader(rule)}{${inner}}`;
    }
  }
  return out;
}
