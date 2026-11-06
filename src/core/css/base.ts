import { parseColor } from '../color';
import type { ColorFn, RuleContext } from '../mapping/types';
import type { Adjustments, StyleColors } from '../settings/schema';

export function buildBaseCss(colors: StyleColors, fn: ColorFn, adj: Adjustments): string {
  const ctx: RuleContext = { selector: 'html', isLink: false, isVisited: false };
  const bg = fn(parseColor('#ffffff')!, 'bg', ctx);
  const text = fn(parseColor('#000000')!, 'text', ctx);
  const surface = fn(parseColor('#f0f0f0')!, 'bg', ctx);
  const border = fn(parseColor('#767676')!, 'border', ctx);
  let css =
    `html, body { background-color: ${bg}; color: ${text}; }\n` +
    `input, textarea, select, button { background-color: ${surface}; color: ${text}; border-color: ${border}; }\n` +
    `::selection { background-color: ${colors.selection}; color: ${text}; }\n` +
    `html { scrollbar-color: ${border} ${bg}; }\n` +
    `:focus-visible { outline-color: ${colors.link}; }\n`;
  if (adj.img > 0) css += `img, video, canvas, picture { filter: brightness(${1 - adj.img / 100}); }\n`;
  return css;
}
