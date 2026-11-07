import type { Role } from '../mapping/types';
import { roleOf } from './declarations';
import { roleFromName } from './var-names';

/** [defined, referenced]: `--b: var(--a)` → ['--b', '--a']. Usages of `--b` flow on to `--a`. */
export type VarLinks = Array<[string, string]>;

/** Anything that tells the role(s) a custom property is used in. */
export interface VarRoles {
  /** Predominant role; no usages → name hint, else 'bg'. */
  roleOf(name: string): Role;
  /** Roles with usages, most frequent first; [] for unknown names. */
  rolesOf(name: string): Role[];
  /** Share of the second role is at least MIXED_SHARE of all usages. */
  isMixed(name: string): boolean;
}

export const MIXED_SHARE = 0.2;
export const MAX_CHAIN_DEPTH = 5;

type RoleCounts = Map<Role, number>;

const ROLE_ORDER: Role[] = ['bg', 'text', 'border', 'shadow'];

/** Roles with usages, by descending count (ties in fixed role order). */
function ranked(m: RoleCounts | undefined): Array<[Role, number]> {
  if (!m) return [];
  return ROLE_ORDER.filter((r) => (m.get(r) ?? 0) > 0)
    .map((r): [Role, number] => [r, m.get(r)!])
    .sort((a, b) => b[1] - a[1]);
}

/** Predominant role of the counts; a tie for first place → 'bg'; null when there are none. */
function predominant(m: RoleCounts | undefined): Role | null {
  const r = ranked(m);
  if (!r.length) return null;
  return r.length > 1 && r[1][1] === r[0][1] ? 'bg' : r[0][0];
}

function mixed(m: RoleCounts | undefined): boolean {
  const r = ranked(m);
  if (r.length < 2) return false;
  const total = r.reduce((s, [, n]) => s + n, 0);
  return r[1][1] / total >= MIXED_SHARE;
}

export class VarRoleCounter implements VarRoles {
  private counts = new Map<string, Map<Role, number>>();

  add(name: string, role: Role, n = 1): void {
    let m = this.counts.get(name);
    if (!m) this.counts.set(name, (m = new Map()));
    const v = (m.get(role) ?? 0) + n;
    if (v > 0) m.set(role, v); else m.delete(role);
    if (!m.size) this.counts.delete(name);
  }

  names(): string[] {
    return [...this.counts.keys()];
  }

  forEach(f: (name: string, role: Role, n: number) => void): void {
    for (const [name, m] of this.counts) for (const [role, n] of m) f(name, role, n);
  }

  /** Direct counts of one name (no chains); undefined when unused. */
  countsOf(name: string): ReadonlyMap<Role, number> | undefined {
    return this.counts.get(name);
  }

  /** Predominant role; ties and unknown names default to 'bg'. */
  roleOf(name: string): Role {
    return predominant(this.counts.get(name)) ?? 'bg';
  }

  rolesOf(name: string): Role[] {
    return ranked(this.counts.get(name)).map(([r]) => r);
  }

  isMixed(name: string): boolean {
    return mixed(this.counts.get(name));
  }
}

interface SourceData {
  counts: VarRoleCounter;
  links: VarLinks;
}

const PAIR_SEP = '\u0000';

/**
 * Role table built from per-source counters and links. Setting a source again replaces its data (no
 * double counting). Effective counts follow `--b: var(--a)` links: eff(a) = direct(a) + Σ eff(d) over
 * distinct links [d, a] (each distinct pair counted once globally), up to MAX_CHAIN_DEPTH links,
 * cycles cut on re-entry. Effective counts are cached per name and invalidated only for the names a
 * change can reach.
 */
export class VarRoleTable implements VarRoles {
  private total = new VarRoleCounter();
  private bySource = new Map<unknown, SourceData>();
  /** Reference count per distinct link pair. */
  private pairRefs = new Map<string, number>();
  /** a → set of d (distinct pairs only), and d → set of a. */
  private upstream = new Map<string, Set<string>>();
  private downstream = new Map<string, Set<string>>();
  private cache = new Map<string, RoleCounts>();

  set(source: unknown, counts: VarRoleCounter, links: VarLinks = []): Set<string> {
    const old = this.bySource.get(source);
    const next: SourceData = { counts, links: links.slice() };
    this.bySource.set(source, next);
    return this.replace(old, next);
  }

  delete(source: unknown): Set<string> {
    const old = this.bySource.get(source);
    if (!old) return new Set();
    this.bySource.delete(source);
    return this.replace(old, undefined);
  }

  clear(): void {
    this.total = new VarRoleCounter();
    this.bySource.clear();
    this.pairRefs.clear();
    this.upstream.clear();
    this.downstream.clear();
    this.cache.clear();
  }

  roleOf(name: string): Role {
    return predominant(this.effective(name)) ?? roleFromName(name) ?? 'bg';
  }

  rolesOf(name: string): Role[] {
    return ranked(this.effective(name)).map(([r]) => r);
  }

  isMixed(name: string): boolean {
    return mixed(this.effective(name));
  }

  private effective(name: string): RoleCounts {
    let m = this.cache.get(name);
    if (!m) {
      m = new Map();
      this.accumulate(name, m, new Set(), 0);
      this.cache.set(name, m);
    }
    return m;
  }

  private accumulate(name: string, into: RoleCounts, path: Set<string>, depth: number): void {
    if (path.has(name)) return;
    path.add(name);
    this.total.countsOf(name)?.forEach((n, role) => into.set(role, (into.get(role) ?? 0) + n));
    if (depth < MAX_CHAIN_DEPTH) {
      const defs = this.upstream.get(name);
      if (defs) for (const d of defs) this.accumulate(d, into, path, depth + 1);
    }
    path.delete(name);
  }

  private signature(name: string): string {
    return `${this.roleOf(name)}|${this.isMixed(name)}|${this.rolesOf(name).join()}`;
  }

  /** Names whose effective counts can change: seeds plus everything reachable d → a within the chain limit. */
  private affected(seeds: Set<string>, extra: VarLinks): Set<string> {
    const extraDown = new Map<string, string[]>();
    for (const [d, a] of extra) {
      let l = extraDown.get(d);
      if (!l) extraDown.set(d, (l = []));
      l.push(a);
    }
    const seen = new Set(seeds);
    let frontier = [...seeds];
    for (let depth = 0; depth < MAX_CHAIN_DEPTH && frontier.length; depth++) {
      const nextFrontier: string[] = [];
      for (const n of frontier) {
        const out = [...(this.downstream.get(n) ?? []), ...(extraDown.get(n) ?? [])];
        for (const a of out) if (!seen.has(a)) { seen.add(a); nextFrontier.push(a); }
      }
      frontier = nextFrontier;
    }
    return seen;
  }

  private addPair(d: string, a: string): void {
    const key = d + PAIR_SEP + a;
    const n = (this.pairRefs.get(key) ?? 0) + 1;
    this.pairRefs.set(key, n);
    if (n > 1) return;
    let up = this.upstream.get(a);
    if (!up) this.upstream.set(a, (up = new Set()));
    up.add(d);
    let down = this.downstream.get(d);
    if (!down) this.downstream.set(d, (down = new Set()));
    down.add(a);
  }

  private removePair(d: string, a: string): void {
    const key = d + PAIR_SEP + a;
    const n = (this.pairRefs.get(key) ?? 0) - 1;
    if (n > 0) { this.pairRefs.set(key, n); return; }
    this.pairRefs.delete(key);
    const up = this.upstream.get(a);
    if (up) { up.delete(d); if (!up.size) this.upstream.delete(a); }
    const down = this.downstream.get(d);
    if (down) { down.delete(a); if (!down.size) this.downstream.delete(d); }
  }

  private replace(old: SourceData | undefined, next: SourceData | undefined): Set<string> {
    const seeds = new Set<string>();
    for (const s of [old, next]) {
      if (!s) continue;
      for (const n of s.counts.names()) seeds.add(n);
      for (const [d, a] of s.links) { seeds.add(d); seeds.add(a); }
    }
    const names = this.affected(seeds, next?.links ?? []);
    const before = new Map<string, string>();
    for (const n of names) before.set(n, this.signature(n));

    old?.counts.forEach((name, role, n) => this.total.add(name, role, -n));
    next?.counts.forEach((name, role, n) => this.total.add(name, role, n));
    if (old) for (const [d, a] of old.links) this.removePair(d, a);
    if (next) for (const [d, a] of next.links) this.addPair(d, a);
    for (const n of names) this.cache.delete(n);

    const changed = new Set<string>();
    for (const n of names) if (this.signature(n) !== before.get(n)) changed.add(n);
    return changed;
  }
}

export function collectVarUsage(prop: string, value: string, counter: VarRoleCounter, links?: VarLinks): void {
  if (prop.startsWith('--')) {
    if (!links) return;
    for (const m of value.matchAll(/var\(\s*(--[^\s,)]+)/gi)) links.push([prop, m[1]]);
    return;
  }
  const role = roleOf(prop);
  if (!role) return;
  for (const m of value.matchAll(/var\(\s*(--[^\s,)]+)/gi)) counter.add(m[1], role);
}
