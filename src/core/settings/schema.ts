import { z } from 'zod';
import { STYLE_KEYS, type StyleKey } from './schema-types';

export * from './schema-types';

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

/** UPDATE_GLOBAL patch: any subset of the fields; `adj` may be partial (merged into the current one). */
export const GlobalPatchSchema = GlobalSettingsSchema.extend({ adj: AdjustmentsSchema.partial() }).partial().strict();

/** UPDATE_SITE patch: any subset of the fields, each a value or null (= remove). */
export const SitePatchSchema = z.object({
  on: z.boolean().nullable(),
  eng: EngineSchema.nullable(),
  st: z.string().nullable(),
  adj: AdjustmentsSchema.partial().nullable(),
  det: z.literal(true).nullable(),
  r: z.array(OverrideRuleSchema).nullable(),
}).partial().strict();
