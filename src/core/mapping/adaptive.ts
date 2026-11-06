import { isNeutral, parseColor, type Oklch } from '../color';
import type { StyleColors } from '../settings/schema-types';
import type { ColorMapper, Role, RuleContext } from './types';

const BG_OFFSET_MIN = 0.06;
const BG_DARK_CAP = BG_OFFSET_MIN; // meets the upper branch at L_in = 0.5 (continuity)
const BG_MAX_CHROMA = 0.12;
const SHADOW_L = 0.3;
const SHADOW_ALPHA = 0.6;
const DEFAULT_LINK_TOLERANCE = 0.01;
const BROWSER_DEFAULT_LINKS = ['#0000ee', '#551a8b'].map((s) => parseColor(s)!);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function isBrowserDefaultLink(c: Oklch): boolean {
  return BROWSER_DEFAULT_LINKS.some(
    (d) => Math.abs(d.l - c.l) <= DEFAULT_LINK_TOLERANCE && Math.abs(d.c - c.c) <= DEFAULT_LINK_TOLERANCE,
  );
}

export function createAdaptiveMapper(colors: StyleColors): ColorMapper {
  const p = (hex: string) => parseColor(hex)!;
  const bg = p(colors.bg);
  const surface = p(colors.surface);
  const text = p(colors.text);
  const textMuted = p(colors.textMuted);
  const border = p(colors.border);
  const link = p(colors.link);
  const linkVisited = p(colors.linkVisited);

  const bgLow = surface.l + BG_OFFSET_MIN;

  function bgL(l: number): number {
    if (l > 0.5) return bgLow + ((l - 0.5) / 0.5) * (bg.l - bgLow);
    return Math.min(l, surface.l + BG_DARK_CAP);
  }

  function textL(l: number): number {
    if (l < 0.5) return text.l + (l / 0.5) * (textMuted.l - text.l);
    return Math.max(l, textMuted.l);
  }

  function lightness(l: number, role: Role): number {
    switch (role) {
      case 'bg': return bgL(l);
      case 'text': return textL(l);
      case 'border': return (bgL(l) + border.l) / 2;
      case 'shadow': return l * SHADOW_L;
    }
  }

  const tintSource = (role: Role): Oklch => (role === 'text' ? text : role === 'border' ? border : bg);

  return {
    prepare() {},
    map(color: Oklch, role: Role, ctx: RuleContext): Oklch {
      if (role === 'text' && ctx.isLink && (isNeutral(color) || isBrowserDefaultLink(color))) {
        const t = ctx.isVisited ? linkVisited : link;
        return { ...t, alpha: color.alpha };
      }
      const l = clamp01(lightness(color.l, role));
      const alpha = role === 'shadow' ? color.alpha * SHADOW_ALPHA : color.alpha;
      if (isNeutral(color)) {
        const t = tintSource(role);
        return { l, c: t.c, h: t.h, alpha };
      }
      const c = role === 'bg' ? Math.min(color.c, BG_MAX_CHROMA) : color.c;
      return { l, c, h: color.h, alpha };
    },
  };
}
