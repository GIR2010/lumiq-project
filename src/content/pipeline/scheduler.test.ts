import { expect, test } from 'vitest';
import { runChunked } from './scheduler';

test('бюджет: задачи после исчерпания не выполняются', async () => {
  let t = 0; const done: number[] = [];
  const tasks = Array.from({ length: 10 }, (_, i) => () => { done.push(i); t += 100; });
  expect(await runChunked(tasks, { syncCount: 2, budgetMs: 450, now: () => t, idle: cb => cb() })).toBe('budget');
  expect(done).toEqual([0, 1, 2, 3, 4]);
});

test('все задачи укладываются в бюджет → done; первые syncCount выполняются синхронно', async () => {
  const done: number[] = [];
  const queued: Array<() => void> = [];
  const tasks = Array.from({ length: 4 }, (_, i) => () => { done.push(i); });
  const p = runChunked(tasks, { syncCount: 2, budgetMs: 1000, now: () => 0, idle: cb => { queued.push(cb); } });
  expect(done).toEqual([0, 1]);
  while (queued.length) queued.shift()!();
  expect(await p).toBe('done');
  expect(done).toEqual([0, 1, 2, 3]);
});

test('syncBudgetMs ограничивает синхронный проход, остаток уходит в idle', async () => {
  let t = 0; const done: number[] = [];
  const queued: Array<() => void> = [];
  const tasks = Array.from({ length: 5 }, (_, i) => () => { done.push(i); t += 100; });
  const p = runChunked(tasks, { syncCount: 5, budgetMs: 10_000, syncBudgetMs: 250, now: () => t, idle: cb => { queued.push(cb); } });
  expect(done).toEqual([0, 1, 2]);
  while (queued.length) queued.shift()!();
  expect(await p).toBe('done');
  expect(done).toEqual([0, 1, 2, 3, 4]);
});

test('исключение в отложенной задаче отклоняет промис', async () => {
  const tasks = [() => {}, () => { throw new Error('boom'); }];
  await expect(runChunked(tasks, { syncCount: 1, budgetMs: 1000, idle: cb => cb() })).rejects.toThrow('boom');
});
