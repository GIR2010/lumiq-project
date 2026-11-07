import { expect, test } from 'vitest';
import { deepEqual } from './deep-equal';

test('deepEqual: вложенные объекты и массивы, порядок ключей не важен', () => {
  expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
  expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  expect(deepEqual([1, 2], [2, 1])).toBe(false);
  expect(deepEqual([], {})).toBe(false);
  expect(deepEqual(null, null)).toBe(true);
  expect(deepEqual(null, {})).toBe(false);
  expect(deepEqual('x', 'x')).toBe(true);
});
