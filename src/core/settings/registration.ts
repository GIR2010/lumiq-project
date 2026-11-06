import type { GlobalSettings, SiteSettings } from './schema';

export interface Registration {
  file: 'placeholder.js' | 'placeholder-sys.js';
  matches: string[];
  excludeMatches: string[];
}

const patterns = (h: string): string[] =>
  h.startsWith('www.') ? [`*://${h}/*`] : [`*://${h}/*`, `*://www.${h}/*`];

export function computeRegistration(
  g: GlobalSettings, sites: Record<string, SiteSettings>,
): Registration | null {
  const file = g.sys ? 'placeholder-sys.js' : 'placeholder.js';
  const entries = Object.entries(sites);
  if (g.def === 'on') {
    return {
      file, matches: ['<all_urls>'],
      excludeMatches: entries.filter(([, s]) => s.on === false).flatMap(([h]) => patterns(h)),
    };
  }
  const matches = entries.filter(([, s]) => s.on === true).flatMap(([h]) => patterns(h));
  return matches.length ? { file, matches, excludeMatches: [] } : null;
}
