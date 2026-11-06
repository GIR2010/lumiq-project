// Types and constants only (no zod): safe to import from the content script.
export const STYLE_KEYS = [
  'bg', 'surface', 'elevated', 'text', 'textMuted', 'onAccent', 'link',
  'linkVisited', 'border', 'accent', 'success', 'warning', 'danger', 'selection',
] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];
export type StyleColors = Record<StyleKey, string>;

export type Engine = 'adaptive' | 'style';

export interface Adjustments { br: number; ct: number; sp: number; gs: number; img: number }
export interface GlobalSettings {
  v: number;
  def: 'on' | 'off';
  sys: boolean;
  eng: Engine;
  st: string;
  adj: Adjustments;
  keepBgImages: boolean;
}
export interface UserStyle { id: string; name: string; c: StyleColors }
export type OverrideRule = [string, string | null, string | null, string | null, number];
export interface SiteSettings {
  on?: boolean;
  eng?: Engine;
  st?: string;
  adj?: Partial<Adjustments>;
  det?: true;
  r?: OverrideRule[];
}
