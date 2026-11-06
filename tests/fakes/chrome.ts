import { vi } from 'vitest';

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type ChangeListener = (changes: Changes, area: string) => void;

function clone<T>(v: T): T { return v === undefined ? v : structuredClone(v); }

function makeArea(name: string, listeners: Set<ChangeListener>) {
  const data = new Map<string, unknown>();
  const notify = (changes: Changes) => {
    if (Object.keys(changes).length) for (const l of [...listeners]) l(changes, name);
  };
  return {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      const out: Record<string, unknown> = {};
      if (keys == null) { for (const [k, v] of data) out[k] = clone(v); return out; }
      if (typeof keys === 'string') keys = [keys];
      if (Array.isArray(keys)) { for (const k of keys) if (data.has(k)) out[k] = clone(data.get(k)); return out; }
      for (const [k, d] of Object.entries(keys)) out[k] = data.has(k) ? clone(data.get(k)) : d;
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(data.get(k)), newValue: clone(v) };
        data.set(k, clone(v));
      }
      notify(changes);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const changes: Changes = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (data.has(k)) { changes[k] = { oldValue: clone(data.get(k)) }; data.delete(k); }
      }
      notify(changes);
    }),
    getBytesInUse: vi.fn(async (keys?: string | string[] | null) => {
      const list = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      return list.reduce((n, k) => n + (data.has(k) ? JSON.stringify(data.get(k)).length + k.length : 0), 0);
    }),
  };
}

function makeEvent<F extends (...a: any[]) => void>() {
  const listeners = new Set<F>();
  return {
    listeners,
    addListener: vi.fn((f: F) => { listeners.add(f); }),
    removeListener: vi.fn((f: F) => { listeners.delete(f); }),
    hasListener: (f: F) => listeners.has(f),
    emit: (...args: Parameters<F>) => { for (const l of [...listeners]) l(...args); },
  };
}

export function installFakeChrome() {
  // storage.onChanged: area changes (from set/remove) and manual emit() share one listener set.
  const changed = makeEvent<ChangeListener>();
  const storage = {
    sync: makeArea('sync', changed.listeners),
    local: makeArea('local', changed.listeners),
    session: makeArea('session', changed.listeners),
    onChanged: changed,
  };
  const registered = new Map<string, { id: string }>();
  const fake = {
    storage,
    runtime: {
      onMessage: makeEvent<(...a: any[]) => void>(),
      sendMessage: vi.fn(async (_msg: unknown) => undefined as unknown),
    },
    tabs: {
      query: vi.fn(async (_q: unknown) => [] as unknown[]),
      get: vi.fn(async (_id: number) => ({}) as unknown),
      sendMessage: vi.fn(async (_id: number, _msg: unknown) => undefined as unknown),
      reload: vi.fn(async (_id?: number) => undefined),
      onRemoved: makeEvent<(...a: any[]) => void>(),
    },
    scripting: {
      registerContentScripts: vi.fn(async (scripts: { id: string }[]) => {
        for (const sc of scripts) if (registered.has(sc.id)) throw new Error(`Duplicate script ID '${sc.id}'`);
        for (const sc of scripts) registered.set(sc.id, clone(sc));
      }),
      updateContentScripts: vi.fn(async (scripts: { id: string }[]) => {
        for (const sc of scripts) if (!registered.has(sc.id)) throw new Error(`Nonexistent script ID '${sc.id}'`);
        for (const sc of scripts) registered.set(sc.id, { ...(registered.get(sc.id) as object), ...clone(sc) } as { id: string });
      }),
      unregisterContentScripts: vi.fn(async (f?: { ids?: string[] }) => {
        for (const id of f?.ids ?? [...registered.keys()]) registered.delete(id);
      }),
      getRegisteredContentScripts: vi.fn(async (f?: { ids?: string[] }) =>
        [...registered.values()].filter((sc) => !f?.ids || f.ids.includes(sc.id)).map((sc) => clone(sc)) as unknown[]),
    },
    action: {
      setBadgeText: vi.fn(async (_d: unknown) => undefined),
      setBadgeBackgroundColor: vi.fn(async (_d: unknown) => undefined),
    },
    commands: { onCommand: makeEvent<(...a: any[]) => void>() },
    i18n: { getMessage: vi.fn((key: string) => key) },
  };
  (globalThis as any).chrome = fake;
  return fake;
}

export type FakeChrome = ReturnType<typeof installFakeChrome>;
