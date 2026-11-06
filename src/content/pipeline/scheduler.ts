export interface ChunkOptions {
  /** Number of leading tasks run synchronously, before runChunked returns. */
  syncCount: number;
  /** Total wall-clock budget, measured from the call; tasks not started by then are dropped. */
  budgetMs: number;
  /** Optional cap on the synchronous pass; tasks past it move to idle chunks. */
  syncBudgetMs?: number;
  now?: () => number;
  idle?: (cb: () => void) => void;
}

/** Longest stretch of work done in a single idle callback. */
const SLICE_MS = 8;
/** Idle callbacks fire at the latest after this long, even while the page stays busy. */
const IDLE_TIMEOUT_MS = 100;

function defaultIdle(cb: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => cb(), { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(cb, 0);
}

/**
 * Runs the first `syncCount` tasks synchronously, the rest in idle-time slices until `budgetMs`
 * (from the call) runs out. A task that throws rejects the promise (or throws, in the sync pass).
 */
export function runChunked(tasks: Array<() => void>, opts: ChunkOptions): Promise<'done' | 'budget'> {
  const now = opts.now ?? (() => performance.now());
  const idle = opts.idle ?? defaultIdle;
  const start = now();
  const elapsed = () => now() - start;
  let i = 0;
  const syncEnd = Math.min(opts.syncCount, tasks.length);
  while (i < syncEnd) {
    if (opts.syncBudgetMs !== undefined && elapsed() >= opts.syncBudgetMs) break;
    tasks[i++]();
  }
  if (i >= tasks.length) return Promise.resolve('done');
  return new Promise((resolve, reject) => {
    const step = () => {
      try {
        const sliceStart = now();
        do {
          if (elapsed() >= opts.budgetMs) {
            resolve('budget');
            return;
          }
          tasks[i++]();
        } while (i < tasks.length && now() - sliceStart < SLICE_MS);
        if (i >= tasks.length) resolve('done');
        else idle(step);
      } catch (e) {
        reject(e);
      }
    };
    idle(step);
  });
}
