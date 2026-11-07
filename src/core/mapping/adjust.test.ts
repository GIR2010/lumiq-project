import { describe, expect, test } from 'vitest';
import { parseColor } from '../color';
import { DEFAULT_ADJUSTMENTS } from '../settings/defaults';
import { applyAdjustments } from './adjust';

const base = parseColor('#808080')!;
const A = DEFAULT_ADJUSTMENTS;

describe('applyAdjustments', () => {
  test('по умолчанию — без изменений', () => expect(applyAdjustments(base, A, 0.2)).toEqual(base));
  test('по умолчанию — без изменений для цветного', () => {
    const c = parseColor('#3366ff')!;
    expect(applyAdjustments(c, A, 0.2)).toEqual(c);
  });
  test('br=50 вдвое снижает L', () =>
    expect(applyAdjustments(base, { ...A, br: 50 }, 0.2).l).toBeCloseTo(base.l / 2));
  test('ct=50 сжимает L к bgL', () =>
    expect(applyAdjustments(base, { ...A, ct: 50 }, 0.2).l).toBeCloseTo(0.2 + (base.l - 0.2) / 2));
  test('gs=100 → c=0', () =>
    expect(applyAdjustments(parseColor('#3366ff')!, { ...A, gs: 100 }, 0.2).c).toBe(0));
  test('L в пределах 0..1 при br=150', () =>
    expect(applyAdjustments(parseColor('#fff')!, { ...A, br: 150 }, 0.2).l).toBeLessThanOrEqual(1));
  test('sp=100 → oklch(0.6 0.05 70)', () => {
    const r = applyAdjustments(parseColor('#3366ff')!, { ...A, sp: 100 }, 0.2);
    expect(r.l).toBeCloseTo(0.6);
    expect(r.c).toBeCloseTo(0.05);
    expect(r.h).toBeCloseTo(70);
  });
  test('сепия смешивает оттенок по кратчайшей дуге', () => {
    const r = applyAdjustments({ l: 0.5, c: 0.1, h: 350, alpha: 1 }, { ...A, sp: 50 }, 0.2);
    expect(r.h).toBeCloseTo(30); // 350 -> 70 via 0: midpoint 30
  });
  test('альфа сохраняется', () =>
    expect(applyAdjustments({ ...base, alpha: 0.4 }, { ...A, br: 80 }, 0.2).alpha).toBe(0.4));
});
