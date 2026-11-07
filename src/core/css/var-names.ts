import type { Role } from '../mapping/types';

const BORDER = ['border', 'divider', 'outline', 'separator', 'stroke'];
const BG = ['background', 'bg', 'wash', 'surface', 'card', 'overlay', 'fill'];
const TEXT = ['text', 'icon', 'foreground', 'fg', 'link', 'accent'];
const TEXT_QUALIFIERS = ['primary', 'secondary']; // only meaningful together with `text` or `icon`

/** Guess a colour role from a CSS custom property name (`--card-background` → `bg`); null when the name says nothing. */
export function roleFromName(name: string): Role | null {
  const words = new Set(name.toLowerCase().split(/[-_]+/).filter(Boolean));
  const has = (list: string[]) => list.some((w) => words.has(w));
  if (words.has('shadow')) return 'shadow';
  if (has(BORDER)) return 'border';
  if (has(BG)) return 'bg';
  if (has(TEXT)) return 'text';
  if (has(TEXT_QUALIFIERS) && (words.has('text') || words.has('icon'))) return 'text';
  return null;
}
