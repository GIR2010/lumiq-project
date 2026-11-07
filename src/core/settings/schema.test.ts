import { expect, test } from 'vitest';
import { GlobalSettingsSchema } from './schema';
import { DEFAULT_ADJUSTMENTS, DEFAULT_GLOBAL } from './defaults';

test('DEFAULT_GLOBAL проходит схему; br=200 — нет', () => {
  expect(GlobalSettingsSchema.safeParse(DEFAULT_GLOBAL).success).toBe(true);
  expect(GlobalSettingsSchema.safeParse({ ...DEFAULT_GLOBAL, adj: { ...DEFAULT_ADJUSTMENTS, br: 200 } }).success).toBe(false);
});
