import { parseColor } from '../color';
import type { ColorFn, RuleContext } from '../mapping/types';
import type { Adjustments, StyleColors } from '../settings/schema-types';

export function buildBaseCss(colors: StyleColors, fn: ColorFn, adj: Adjustments): string {
  const ctx: RuleContext = { selector: 'html', isLink: false, isVisited: false };
  const bg = fn(parseColor('#ffffff')!, 'bg', ctx);
  const text = fn(parseColor('#000000')!, 'text', ctx);
  const surface = fn(parseColor('#f0f0f0')!, 'bg', ctx);
  const border = fn(parseColor('#767676')!, 'border', ctx);
  let css =
    // Dark UA defaults (form controls, scrollbars, canvas); switched off with the rest during detection.
    `:root { color-scheme: dark; }\n` +
    `html, body { background-color: ${bg}; color: ${text}; }\n` +
    `input, textarea, select, button { background-color: ${surface}; color: ${text}; border-color: ${border}; }\n` +
    `pre, code { background-color: ${surface}; }\n` +
    `table, th, td { border-color: ${border}; }\n` +
    `hr { border-color: ${border}; }\n` +
    `::placeholder { color: ${colors.textMuted}; }\n` +
    `::selection { background-color: ${colors.selection}; color: ${text}; }\n` +
    `:focus-visible { outline-color: ${colors.link}; }\n`;
  if (adj.img > 0) css += `img, video, canvas, picture { filter: brightness(${1 - adj.img / 100}); }\n`;
  // Dark icon <img> (marked by ImgIcons); in the base sheet so setDisabled switches it off with the rest.
  css += `img[data-darkext-icon]{filter:invert(1) hue-rotate(180deg) !important}\n`;
  return css;
}

/** Transient guard against a light flash while the page's sheets (e.g. from a CDN) are still on their way. */
export function buildFallbackCss(fn: ColorFn): string {
  const ctx: RuleContext = { selector: 'html', isLink: false, isVisited: false };
  const bg = fn(parseColor('#ffffff')!, 'bg', ctx);
  const text = fn(parseColor('#000000')!, 'text', ctx);
  return `html,body{background-color:${bg} !important;color:${text} !important}`;
}
