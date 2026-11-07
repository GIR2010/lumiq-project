import type { Oklch } from './color';

export interface DarknessInput {
  samples: Oklch[];
  colorScheme: string;
  metaScheme: string | null;
  systemDark: boolean;
}

function schemeTokens(s: string | null): Set<string> {
  return new Set((s ?? '').toLowerCase().split(/\s+/).filter((t) => t === 'light' || t === 'dark'));
}

export function classifyDarkness(input: DarknessInput): 'dark' | 'light' | 'unsure' {
  const { samples } = input;
  if (samples.length === 0) return 'unsure';
  const l = samples.reduce((a, s) => a + s.l, 0) / samples.length;
  if (l < 0.4) return 'dark';
  if (l >= 0.6) return 'light';
  for (const t of [schemeTokens(input.colorScheme), schemeTokens(input.metaScheme)]) {
    if (t.has('dark') && !t.has('light')) return 'dark';
    if (t.has('dark') && t.has('light') && input.systemDark) return 'dark';
  }
  return 'unsure';
}
