import { parseColor } from '../color';
import type { ColorFn, Role, RuleContext } from '../mapping/types';

const sides = ['top', 'right', 'bottom', 'left'].map((s) => `border-${s}-color`);
const logical = ['block', 'inline'].flatMap((a) => ['start', 'end'].map((b) => `border-${a}-${b}-color`));

const entries: Array<[string, Role]> = [
  ['background-color', 'bg'], ['background-image', 'bg'],
  ...['color', 'fill', 'stroke', 'caret-color', 'text-decoration-color', '-webkit-text-fill-color']
    .map((p): [string, Role] => [p, 'text']),
  ...[...sides, ...logical, 'outline-color', 'column-rule-color'].map((p): [string, Role] => [p, 'border']),
  ['box-shadow', 'shadow'], ['text-shadow', 'shadow'],
];

export const PROPERTY_ROLES: Readonly<Record<string, Role>> = Object.freeze(Object.fromEntries(entries));

export function roleOf(prop: string): Role | null {
  return PROPERTY_ROLES[prop.trim().toLowerCase()] ?? null;
}

const TOKEN = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)|\b[a-z]+\b/gi;

interface Mapped { text: string; changed: boolean }

function mapTokens(value: string, role: Role, fn: ColorFn, ctx: RuleContext): Mapped {
  const lower = value.toLowerCase();
  let out = '';
  let pos = 0;
  let changed = false;
  while (pos < value.length) {
    const varIdx = lower.indexOf('var(', pos);
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(value);
    if (varIdx >= 0 && (!m || varIdx <= m.index)) {
      // Copy up to var(, keep the custom property name, map only the fallback.
      out += value.slice(pos, varIdx + 4);
      let depth = 1;
      let i = varIdx + 4;
      let comma = -1;
      for (; i < value.length && depth > 0; i++) {
        const ch = value[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 1 && comma < 0) comma = i;
      }
      const end = depth === 0 ? i - 1 : value.length; // index of closing paren
      if (comma < 0) {
        out += value.slice(varIdx + 4, end);
      } else {
        const fb = mapTokens(value.slice(comma + 1, end), role, fn, ctx);
        out += value.slice(varIdx + 4, comma + 1) + fb.text;
        changed ||= fb.changed;
      }
      if (depth === 0) out += ')';
      pos = end + 1;
      continue;
    }
    if (!m) break;
    out += value.slice(pos, m.index);
    const color = parseColor(m[0]);
    if (color) {
      out += fn(color, role, ctx);
      changed = true;
    } else {
      out += m[0];
    }
    pos = m.index + m[0].length;
  }
  out += value.slice(pos);
  return { text: out, changed };
}

export function mapDeclarationValue(prop: string, value: string, fn: ColorFn, ctx: RuleContext): string | null {
  const role = roleOf(prop);
  if (!role) return null;
  if (value.toLowerCase().includes('color-mix(')) return null;
  if (prop.trim().toLowerCase() === 'background-image') {
    const v = value.toLowerCase();
    if (v.includes('url(') || !v.includes('gradient(')) return null;
  }
  const r = mapTokens(value, role, fn, ctx);
  return r.changed ? r.text : null;
}

export function isLinkSelector(selector: string): { isLink: boolean; isVisited: boolean } {
  let isLink = false;
  for (const part of selector.split(',')) {
    const last = part.trim().split(/[\s>+~]+/).pop() ?? '';
    if (/^a(?![\w-])/i.test(last)) isLink = true;
  }
  return { isLink, isVisited: /:visited\b/i.test(selector) };
}
