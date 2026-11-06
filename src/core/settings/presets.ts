import { STYLE_KEYS, type StyleColors, type UserStyle } from './schema-types';

export type PresetId = 'graphite' | 'midnight' | 'oled' | 'warm' | 'contrast';

// Values in STYLE_KEYS order.
const row = (...v: string[]): StyleColors =>
  Object.fromEntries(STYLE_KEYS.map((k, i) => [k, v[i]])) as StyleColors;

export const PRESETS: ReadonlyArray<{ id: PresetId; nameKey: `preset_${PresetId}`; colors: StyleColors }> = [
  { id: 'graphite', nameKey: 'preset_graphite', colors: row('#1e1f22', '#26282c', '#303236', '#e3e3e3', '#a0a4ab', '#10141a', '#7cb4ff', '#c49cff', '#3c3f44', '#6ea8fe', '#5fc47e', '#e8b04a', '#f2706b', '#2f4a73') },
  { id: 'midnight', nameKey: 'preset_midnight', colors: row('#0f1724', '#162133', '#1e2b40', '#dbe4f0', '#8fa0b8', '#0b1220', '#79b8ff', '#b392f0', '#2a3a52', '#4f9cf9', '#4cc38a', '#e5b454', '#f47174', '#24476f') },
  { id: 'oled', nameKey: 'preset_oled', colors: row('#000000', '#0d0d0d', '#1a1a1a', '#e6e6e6', '#9a9a9a', '#000000', '#6cb6ff', '#c8a2ff', '#2b2b2b', '#5aa9ff', '#4ade80', '#facc15', '#f87171', '#1f3a5f') },
  { id: 'warm', nameKey: 'preset_warm', colors: row('#221c17', '#2b241e', '#352d26', '#eadfcf', '#b3a48f', '#1d1712', '#e6b673', '#d49a8a', '#43382e', '#d9a35b', '#9cc27a', '#e6b450', '#e07a5f', '#5a4632') },
  { id: 'contrast', nameKey: 'preset_contrast', colors: row('#000000', '#0a0a0a', '#141414', '#ffffff', '#d0d0d0', '#000000', '#66ccff', '#ff99ff', '#ffffff', '#ffd400', '#33ff99', '#ffcc00', '#ff5c5c', '#0050a0') },
];

export function findStyle(id: string, user: UserStyle[]): { id: string; colors: StyleColors } {
  const u = user.find((s) => s.id === id);
  if (u) return { id: u.id, colors: u.c };
  const p = PRESETS.find((s) => s.id === id) ?? PRESETS[0];
  return { id: p.id, colors: p.colors };
}
