import type { Oklch } from '../color';

export type Role = 'bg' | 'text' | 'border' | 'shadow';

export interface RuleContext {
  selector: string;
  isLink: boolean;
  isVisited: boolean;
  pairedBg?: Oklch;
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
