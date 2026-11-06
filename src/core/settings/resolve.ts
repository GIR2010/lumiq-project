import { findStyle } from './presets';
import type { Adjustments, Engine, GlobalSettings, OverrideRule, SiteSettings, StyleColors, UserStyle } from './schema-types';

export interface EffectiveConfig {
  host: string; enabled: boolean; followSystem: boolean; ignoreDetection: boolean;
  engine: Engine; styleId: string; colors: StyleColors; adj: Adjustments;
  keepBgImages: boolean; overrides: OverrideRule[];
}

export type ApplyStatus = 'active' | 'off' | 'system-light' | 'already-dark';

/** Site key: lowercase hostname without leading "www."; http(s) only. */
export function siteKey(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase().replace(/^www\./, '');
  return h || null;
}

export function resolveConfig(
  host: string, g: GlobalSettings, site: SiteSettings | undefined, user: UserStyle[],
): EffectiveConfig {
  const style = findStyle(site?.st ?? g.st, user);
  return {
    host,
    enabled: site?.on ?? g.def === 'on',
    followSystem: g.sys,
    ignoreDetection: !!site?.det,
    engine: site?.eng ?? g.eng,
    styleId: style.id,
    colors: style.colors,
    adj: { ...g.adj, ...site?.adj },
    keepBgImages: g.keepBgImages,
    overrides: site?.r ?? [],
  };
}

export function shouldApply(
  cfg: EffectiveConfig, env: { systemDark: boolean; pageIsDark: boolean | null },
): { apply: boolean; status: ApplyStatus } {
  if (!cfg.enabled) return { apply: false, status: 'off' };
  if (cfg.followSystem && !env.systemDark) return { apply: false, status: 'system-light' };
  if (env.pageIsDark === true && !cfg.ignoreDetection) return { apply: false, status: 'already-dark' };
  return { apply: true, status: 'active' };
}
