import { describe, expect, test, vi } from 'vitest';
import { parseColor, type Oklch } from '../color';
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
  test('возвращает hex после корректировок', () => {
    const spy = { prepare() {}, map: (c: Oklch) => c };
    const fn = createColorFn(spy, { ...DEFAULT_ADJUSTMENTS, gs: 100 }, PRESETS[0].colors);
    expect(fn(parseColor('#3366ff')!, 'bg', ctx)).toMatch(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$|^#[0-9a-f]{6}$/);
  });
});
