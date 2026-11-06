import { describe, expect, test } from 'vitest';
import { formatColor, parseColor } from '../color';
import { PRESETS } from '../settings/presets';
import { createAdaptiveMapper } from './adaptive';
import type { RuleContext } from './types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = PRESETS[0].colors; // graphite
const m = createAdaptiveMapper(C);
const ctx: RuleContext = { selector: 'div', isLink: false, isVisited: false };
const L = (s: string) => parseColor(s)!.l;

describe('adaptive mapper', () => {
  test('белый фон → bg стиля', () => expect(formatColor(m.map(parseColor('#fff')!, 'bg', ctx))).toBe(C.bg));
  test('чёрный текст → text стиля', () => expect(formatColor(m.map(parseColor('#000')!, 'text', ctx))).toBe(C.text));
  test('оттенок цветного фона сохраняется (±3°)', () => {
    const src = parseColor('#cfe3ff')!;
    expect(Math.abs(m.map(src, 'bg', ctx).h - src.h)).toBeLessThan(3);
  });
  test('насыщенность фона ≤ 0.12', () =>
    expect(m.map(parseColor('#ffeb3b')!, 'bg', ctx).c).toBeLessThanOrEqual(0.12 + 1e-6));
  test('монотонность фона: светлее на входе → не светлее на выходе (1000 случайных пар)', () => {
    const rnd = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const a = { l: 0.5 + rnd() * 0.5, c: rnd() * 0.1, h: rnd() * 360, alpha: 1 };
      const b = { ...a, l: Math.min(1, a.l + 0.01 + rnd() * 0.2) };
      expect(m.map(b, 'bg', ctx).l).toBeLessThanOrEqual(m.map(a, 'bg', ctx).l + 1e-9);
    }
  });
  test('тёмный фон остаётся тёмным', () =>
    expect(m.map(parseColor('#202020')!, 'bg', ctx).l).toBeLessThanOrEqual(L(C.surface) + 0.1 + 1e-6));
  test('светлый текст остаётся светлым', () =>
    expect(m.map(parseColor('#eeeeee')!, 'text', ctx).l).toBeGreaterThanOrEqual(L(C.textMuted) - 1e-6));
  test('ссылка по умолчанию → link / linkVisited', () => {
    expect(formatColor(m.map(parseColor('#0000ee')!, 'text', { ...ctx, isLink: true }))).toBe(C.link);
    expect(formatColor(m.map(parseColor('#551a8b')!, 'text', { ...ctx, isLink: true, isVisited: true }))).toBe(
      C.linkVisited,
    );
  });
  test('альфа сохраняется', () =>
    expect(m.map(parseColor('rgba(255,255,255,.4)')!, 'bg', ctx).alpha).toBeCloseTo(0.4));
  test('тень: L×0.3, альфа×0.6', () => {
    const r = m.map(parseColor('rgba(0,0,0,.5)')!, 'shadow', ctx);
    expect(r.alpha).toBeCloseTo(0.3);
  });
  test('нейтральная рамка тонируется цветом border', () => {
    const r = m.map(parseColor('#cccccc')!, 'border', ctx);
    const b = parseColor(C.border)!;
    expect(r.h).toBeCloseTo(b.h);
    expect(r.c).toBeCloseTo(b.c);
  });
  test('нейтральный цвет ссылки (isLink) → link', () => {
    expect(formatColor(m.map(parseColor('#333333')!, 'text', { ...ctx, isLink: true }))).toBe(C.link);
  });
});
