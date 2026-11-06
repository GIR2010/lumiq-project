import { formatColor, parseColor, type Oklch } from '../color';
import type { Adjustments, StyleColors } from '../settings/schema-types';
import { applyAdjustments } from './adjust';
import type { ColorFn, ColorMapper, Role, RuleContext } from './types';

export function createColorFn(mapper: ColorMapper, adj: Adjustments, colors: StyleColors): ColorFn {
  const bgL = parseColor(colors.bg)!.l;
  const cache = new Map<string, string>();
  return (color: Oklch, role: Role, ctx: RuleContext): string => {
    const key = `${color.l},${color.c},${color.h},${color.alpha}|${role}|${ctx.isLink}${ctx.isVisited}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const out = formatColor(applyAdjustments(mapper.map(color, role, ctx), adj, bgL));
    cache.set(key, out);
    return out;
  };
}
