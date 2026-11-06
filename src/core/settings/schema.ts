import { z } from 'zod';

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

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const EngineSchema = z.enum(['adaptive', 'style']);

export const StyleColorsSchema = z.object(
  Object.fromEntries(STYLE_KEYS.map((k) => [k, Hex])) as Record<StyleKey, typeof Hex>,
);

const br = z.number().min(50).max(150);
const pct = z.number().min(0).max(100);
export const AdjustmentsSchema = z.object({
  br, ct: br, sp: pct, gs: pct, img: z.number().min(0).max(30),
});

export const GlobalSettingsSchema = z.object({
  v: z.number().int(),
  def: z.enum(['on', 'off']),
  sys: z.boolean(),
  eng: EngineSchema,
  st: z.string(),
  adj: AdjustmentsSchema,
  keepBgImages: z.boolean(),
});

const OverrideRuleSchema = z.tuple([
  z.string(), z.string().nullable(), z.string().nullable(), z.string().nullable(), z.number(),
]);

export const SiteSettingsSchema = z.object({
  on: z.boolean().optional(),
  eng: EngineSchema.optional(),
  st: z.string().optional(),
  adj: AdjustmentsSchema.partial().optional(),
  det: z.literal(true).optional(),
  r: z.array(OverrideRuleSchema).optional(),
});

export const UserStyleSchema = z.object({
  id: z.string(),
  name: z.string(),
  c: StyleColorsSchema,
});
