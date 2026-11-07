import type { Role } from '../mapping/types';
import { roleOf } from './declarations';

/** Anything that tells the role a custom property is used in. */
export interface VarRoles {
  roleOf(name: string): Role;
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

  /** Predominant role; ties and unknown names default to 'bg'. */
  roleOf(name: string): Role {
    const m = this.counts.get(name);
    if (!m) return 'bg';
    let best: Role = 'bg';
    let bestN = 0;
    let tie = false;
    for (const [role, n] of m) {
      if (n > bestN) { best = role; bestN = n; tie = false; }
      else if (n === bestN) tie = true;
    }
    return tie ? 'bg' : best;
  }
}

/**
 * Role table built from per-source counters. Setting a source again replaces its counts (no double
 * counting); both `set` and `delete` return the variables whose predominant role changed.
 */
export class VarRoleTable implements VarRoles {
  private total = new VarRoleCounter();
  private bySource = new Map<unknown, VarRoleCounter>();

  set(source: unknown, counts: VarRoleCounter): Set<string> {
    const old = this.bySource.get(source);
    this.bySource.set(source, counts);
    return this.replace(old, counts);
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
  }

  roleOf(name: string): Role {
    return this.total.roleOf(name);
  }

  private replace(old: VarRoleCounter | undefined, next: VarRoleCounter | undefined): Set<string> {
    const names = new Set([...(old?.names() ?? []), ...(next?.names() ?? [])]);
    const before = new Map([...names].map((n) => [n, this.total.roleOf(n)]));
    old?.forEach((name, role, n) => this.total.add(name, role, -n));
    next?.forEach((name, role, n) => this.total.add(name, role, n));
    const changed = new Set<string>();
    for (const n of names) if (this.total.roleOf(n) !== before.get(n)) changed.add(n);
    return changed;
  }
}

export function collectVarUsage(prop: string, value: string, counter: VarRoleCounter): void {
  const role = roleOf(prop);
  if (!role) return;
  for (const m of value.matchAll(/var\(\s*(--[^\s,)]+)/gi)) counter.add(m[1], role);
}
