import { describe, expect, test, vi } from 'vitest';
import { formatColor, parseColor, type Oklch } from '../color';
import { applyAdjustments } from './adjust';
import { DEFAULT_ADJUSTMENTS } from '../settings/defaults';
import { PRESETS } from '../settings/presets';
import { createColorFn } from './color-fn';
import type { RuleContext } from './types';

const ctx: RuleContext = { selector: 'div', isLink: false, isVisited: false };

describe('createColorFn', () => {
  test('мемоизация: mapper.map вызывается один раз на ключ', () => {
    const spy = { prepare() {}, map: vi.fn((c: Oklch) => c) };
    const fn = createColorFn(spy, DEFAULT_ADJUSTMENTS, PRESETS[0].colors);
    fn(parseColor('#fff')!, 'bg', ctx);
    fn(parseColor('#ffffff')!, 'bg', ctx);
    expect(spy.map).toHaveBeenCalledTimes(1);
  });
  test('разные роли — разные ключи', () => {
    const spy = { prepare() {}, map: vi.fn((c: Oklch) => c) };
    const fn = createColorFn(spy, DEFAULT_ADJUSTMENTS, PRESETS[0].colors);
    fn(parseColor('#fff')!, 'bg', ctx);
    fn(parseColor('#fff')!, 'text', ctx);
    expect(spy.map).toHaveBeenCalledTimes(2);
  });
  test('gs=100 даёт точный серый hex', () => {
    const spy = { prepare() {}, map: (c: Oklch) => c };
    const src = parseColor('#3366ff')!;
    const fn = createColorFn(spy, { ...DEFAULT_ADJUSTMENTS, gs: 100 }, PRESETS[0].colors);
    expect(fn(src, 'bg', ctx)).toBe(formatColor({ ...src, c: 0 }));
  });
  test('ct=50 использует bgL = L(colors.bg)', () => {
    const spy = { prepare() {}, map: (c: Oklch) => c };
    const colors = PRESETS[0].colors;
    const adj = { ...DEFAULT_ADJUSTMENTS, ct: 50 };
    const src = parseColor('#808080')!;
    const expected = formatColor(applyAdjustments(src, adj, parseColor(colors.bg)!.l));
    const wrong = formatColor(applyAdjustments(src, adj, 0));
    expect(wrong).not.toBe(expected);
    expect(createColorFn(spy, adj, colors)(src, 'bg', ctx)).toBe(expected);
  });
});
