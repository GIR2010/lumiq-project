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

/**
 * Colour-carrying shorthands. Chrome keeps a shorthand whose value contains var() unexpanded (its
 * longhands read as empty), so such declarations are only reachable through the shorthand itself.
 */
const borderShorthands = ['border', 'border-color', ...['top', 'right', 'bottom', 'left', 'block', 'inline',
  'block-start', 'block-end', 'inline-start', 'inline-end'].map((s) => `border-${s}`)];
export const SHORTHAND_ROLES: Readonly<Record<string, Role>> = Object.freeze(Object.fromEntries<Role>([
  ['background', 'bg'],
  ...[...borderShorthands, 'outline', 'column-rule'].map((p): [string, Role] => [p, 'border']),
  ['text-decoration', 'text'],
]));

export function roleOf(prop: string): Role | null {
  const p = prop.trim().toLowerCase();
  return (Object.hasOwn(PROPERTY_ROLES, p) ? PROPERTY_ROLES[p] : null)
    ?? (Object.hasOwn(SHORTHAND_ROLES, p) ? SHORTHAND_ROLES[p] : null);
}

const TOKEN = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)|\b[a-z]+\b/gi;

/** End (exclusive) of an opaque span starting at `start`: a quoted string or url(...). */
function opaqueEnd(value: string, start: number): number {
  const isString = value[start] === '"' || value[start] === "'";
  let i = isString ? start : start + 4; // skip "url("
  let quote = isString ? value[start] : '';
  if (isString) i++;
  for (; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\') i++;
    else if (quote) {
      if (ch === quote) {
        quote = '';
        if (isString) return i + 1;
      }
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ')') return i + 1;
  }
  return value.length;
}

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
    const urlRe = /(?<![\w-])url\(|["']/gi;
    urlRe.lastIndex = pos;
    const op = urlRe.exec(value);
    if (op && (!m || op.index <= m.index) && (varIdx < 0 || op.index < varIdx)) {
      const end = opaqueEnd(value, op.index);
      out += value.slice(pos, end);
      pos = end;
      continue;
    }
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
    const prev = m.index > 0 ? value[m.index - 1] : '';
    const isWord = /^[a-z]/i.test(m[0]);
    const notColorPos = isWord && (/[\w#.-]/.test(prev) || value[m.index + m[0].length] === '(');
    const color = notColorPos ? null : parseColor(m[0]);
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

/** Maps colors in `value` using an explicit role (e.g. for custom properties). Null when nothing changed. */
export function mapValueWithRole(value: string, role: Role, fn: ColorFn, ctx: RuleContext, prop = ''): string | null {
  const p = prop.trim().toLowerCase();
  const v = value.toLowerCase();
  // Relative url()s would resolve against the page instead of the source sheet — leave those alone.
  if ((p === 'background-image' || p === 'background') && v.includes('url(')) return null;
  if (p === 'background-image' && !v.includes('gradient(')) return null;
  const r = mapTokens(value, role, fn, ctx);
  return r.changed ? r.text : null;
}

export function mapDeclarationValue(prop: string, value: string, fn: ColorFn, ctx: RuleContext): string | null {
  const role = roleOf(prop);
  if (!role) return null;
  return mapValueWithRole(value, role, fn, ctx, prop);
}

export function isLinkSelector(selector: string): { isLink: boolean; isVisited: boolean } {
  let isLink = false;
  for (const part of selector.split(',')) {
    const last = part.trim().split(/[\s>+~]+/).pop() ?? '';
    if (/^a(?![\w-])/i.test(last)) isLink = true;
  }
  return { isLink, isVisited: /:visited\b/i.test(selector) };
}
