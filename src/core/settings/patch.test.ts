import { expect, test } from 'vitest';
import { applyGlobalPatch, applySitePatch } from './patch';
import { DEFAULT_ADJUSTMENTS, DEFAULT_GLOBAL } from './defaults';

test('null удаляет поле, пустой сайт → undefined', () => {
  expect(applySitePatch({ on: true }, { on: null })).toBeUndefined();
  expect(applySitePatch(undefined, { det: true })).toEqual({ det: true });
});
test('adj сливается частично', () => {
  expect(applySitePatch({ adj: { br: 90 } }, { adj: { sp: 10 } })).toEqual({ adj: { br: 90, sp: 10 } });
  expect(applyGlobalPatch(DEFAULT_GLOBAL, { adj: { ...DEFAULT_ADJUSTMENTS, br: 120 } }).adj.br).toBe(120);
});
