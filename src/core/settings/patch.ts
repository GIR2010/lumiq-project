import type { GlobalSettings, SiteSettings } from './schema';

export type Patch<T> = { [K in keyof T]?: T[K] | null };

export function applyGlobalPatch(g: GlobalSettings, p: Partial<GlobalSettings>): GlobalSettings {
  return { ...g, ...p, adj: { ...g.adj, ...p.adj } };
}

export function applySitePatch(s: SiteSettings | undefined, p: Patch<SiteSettings>): SiteSettings | undefined {
  const out: Record<string, unknown> = { ...s };
  for (const [k, val] of Object.entries(p)) {
    if (val === undefined) continue;
    if (val === null) delete out[k];
    else if (k === 'adj') out.adj = { ...s?.adj, ...(val as object) };
    else out[k] = val;
  }
  return Object.keys(out).length ? (out as SiteSettings) : undefined;
}
