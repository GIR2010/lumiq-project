import type { Role } from '../mapping/types';
import { roleOf } from './declarations';

export class VarRoleCounter {
  private counts = new Map<string, Map<Role, number>>();

  add(name: string, role: Role): void {
    let m = this.counts.get(name);
    if (!m) this.counts.set(name, (m = new Map()));
    m.set(role, (m.get(role) ?? 0) + 1);
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

export function collectVarUsage(prop: string, value: string, counter: VarRoleCounter): void {
  const role = roleOf(prop);
  if (!role) return;
  for (const m of value.matchAll(/var\(\s*(--[^\s,)]+)/gi)) counter.add(m[1], role);
}
