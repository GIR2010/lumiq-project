import type { Adjustments, GlobalSettings } from './schema-types';

export const SCHEMA_VERSION = 1;

export const DEFAULT_ADJUSTMENTS: Adjustments = { br: 100, ct: 100, sp: 0, gs: 0, img: 0 };

export const DEFAULT_GLOBAL: GlobalSettings = {
  v: SCHEMA_VERSION,
  def: 'on',
  sys: false,
  eng: 'adaptive',
  st: 'graphite',
  adj: DEFAULT_ADJUSTMENTS,
  keepBgImages: true,
};
