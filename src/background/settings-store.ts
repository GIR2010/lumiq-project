import { applyGlobalPatch, applySitePatch, type Patch } from '../core/settings/patch';
import { DEFAULT_GLOBAL } from '../core/settings/defaults';
import { siteKey } from '../core/settings/resolve';
import {
  GlobalSettingsSchema, SiteSettingsSchema, UserStyleSchema,
  type GlobalSettings, type SiteSettings, type UserStyle,
} from '../core/settings/schema';
import type { Snapshot } from '../shared/messages';

const SITE_PREFIX = 's:';
const warn = (msg: string) => console.warn(`[DarkExt] ${msg}`);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class SettingsStore {
  readonly ready: Promise<void>;
  private g: GlobalSettings = DEFAULT_GLOBAL;
  private styles: UserStyle[] = [];
  private sites: Record<string, SiteSettings> = {};
  private listeners = new Set<(s: Snapshot) => void>();
  private pending = new Map<string, { value: unknown; timer: ReturnType<typeof setTimeout> }>();
  private lastWritten = new Map<string, unknown>();
  private debounceMs: number;
  private loading = true;
  private touched = new Set<string>();

  constructor(opts: { debounceMs?: number } = {}) {
    this.debounceMs = opts.debounceMs ?? 500;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      let changed = false;
      for (const [key, ch] of Object.entries(changes)) {
        if (this.lastWritten.has(key) && same(this.lastWritten.get(key), ch.newValue)) {
          this.lastWritten.delete(key); // echo consumed once
          continue;
        }
        if (this.pending.has(key)) continue; // local pending write wins
        this.lastWritten.delete(key);
        if (this.loading) this.touched.add(key);
        if (this.applyRecord(key, ch.newValue)) changed = true;
      }
      if (changed) this.emit();
    });
    this.ready = this.load();
  }

  snapshot(): Snapshot {
    return { g: this.g, styles: this.styles, sites: this.sites };
  }

  updateGlobal(patch: Partial<GlobalSettings>): void {
    this.g = applyGlobalPatch(this.g, patch);
    this.schedule('g', this.g);
    this.emit();
  }

  updateSite(host: string, patch: Patch<SiteSettings> | null): void {
    const next = patch === null ? undefined : applySitePatch(this.sites[host], patch);
    const sites = { ...this.sites };
    if (next) sites[host] = next; else delete sites[host];
    this.sites = sites;
    this.schedule(SITE_PREFIX + host, next);
    this.emit();
  }

  onChange(cb: (s: Snapshot) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((k) => this.write(k)));
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of [...this.listeners]) cb(snap);
  }

  private schedule(key: string, value: unknown): void {
    if (this.loading) this.touched.add(key);
    const prev = this.pending.get(key);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => { void this.write(key); }, this.debounceMs);
    this.pending.set(key, { value, timer });
  }

  private async write(key: string): Promise<void> {
    const entry = this.pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    this.lastWritten.set(key, entry.value);
    try {
      if (entry.value === undefined) await chrome.storage.sync.remove(key);
      else await chrome.storage.sync.set({ [key]: entry.value });
    } catch (e) {
      this.lastWritten.delete(key);
      console.warn('[DarkExt] settings write failed', key, e);
    }
  }

  private async load(): Promise<void> {
    let changed = false;
    try {
      const all = await chrome.storage.sync.get(null);
      for (const [key, value] of Object.entries(all)) {
        if (this.pending.has(key) || this.touched.has(key)) continue;
        if (this.applyRecord(key, value)) changed = true;
      }
    } catch (e) {
      console.warn('[DarkExt] settings load failed', e);
    } finally {
      this.loading = false;
      this.touched.clear();
    }
    if (changed) this.emit();
  }

  /** Validates and applies one stored record; returns true if the in-memory state changed. */
  private applyRecord(key: string, value: unknown): boolean {
    if (key === 'g') {
      if (value === undefined) { this.g = DEFAULT_GLOBAL; return true; }
      const r = GlobalSettingsSchema.safeParse(value);
      if (!r.success) { warn('invalid global settings dropped'); return false; }
      this.g = r.data; return true;
    }
    if (key === 'styles') {
      const list = Array.isArray(value) ? value : [];
      this.styles = list.flatMap((item) => {
        const r = UserStyleSchema.safeParse(item);
        if (!r.success) { warn('invalid user style dropped'); return []; }
        return [r.data];
      });
      return true;
    }
    if (key.startsWith(SITE_PREFIX)) {
      const host = key.slice(SITE_PREFIX.length);
      if (host !== siteKey('https://' + host)) { warn(`site key dropped: ${key}`); return false; }
      const sites = { ...this.sites };
      if (value === undefined) delete sites[host];
      else {
        const r = SiteSettingsSchema.safeParse(value);
        if (!r.success) { warn(`invalid site settings dropped: ${key}`); return false; }
        sites[host] = r.data;
      }
      this.sites = sites; return true;
    }
    return false;
  }
}
