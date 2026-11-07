import type { Oklch } from '../color';
import type { VarRoles } from '../css/vars';

export type Role = 'bg' | 'text' | 'border' | 'shadow';

export interface RuleContext {
  selector: string;
  isLink: boolean;
  isVisited: boolean;
  pairedBg?: Oklch;
  vars?: Pick<VarRoles, 'roleOf' | 'isMixed'>;
}

export interface PageColorStats {
  entries: Array<{ color: Oklch; role: Role; count: number; isLink: boolean }>;
  baseBg: Oklch | null;
}

export interface ColorMapper {
  prepare(stats: PageColorStats): void;
  map(color: Oklch, role: Role, ctx: RuleContext): Oklch;
}

export type ColorFn = (color: Oklch, role: Role, ctx: RuleContext) => string;
