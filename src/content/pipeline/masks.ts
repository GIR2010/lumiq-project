import { isGroupingRule, isStyleRule } from './sheets';

const MAX_SELECTORS = 500;
const MAX_SIGNATURES = 300;
const CHUNK = 50;
const MASK_PROPS = ['mask-image', '-webkit-mask-image', 'mask', '-webkit-mask'];
const CSS_TEXT_RE = /(?:^|[\s;{])(?:-webkit-)?mask(?:-image)?\s*:[^;}]*url\(/i;

function hasMaskUrl(rule: CSSStyleRule): boolean {
  for (const p of MASK_PROPS) {
    let v = '';
    try {
      v = rule.style.getPropertyValue(p);
    } catch {
      /* ignore */
    }
    if (/url\(/i.test(v)) return true;
  }
  // jsdom (and some engines) do not expose every mask property: scan the serialized rule too.
  try {
    return CSS_TEXT_RE.test(rule.cssText);
  } catch {
    return false;
  }
}

function signature(el: Element): string {
  return `${el.tagName.toLowerCase()}.${[...el.classList].sort().join('.')}`;
}

/** Index of elements painted with CSS masks (their background-color is an icon colour). Grow-only until clear(). */
export class MaskIndex {
  private selectors = new Set<string>();
  private reps = new Map<string, Element>();
  private cache = new Map<string, boolean>();

  // `doc` is kept for symmetry with the other per-document helpers.
  constructor(private readonly doc: Document) {}

  collect(rules: CSSRuleList): boolean {
    const before = this.selectors.size;
    this.walk(rules);
    return this.selectors.size > before;
  }

  private walk(rules: CSSRuleList): void {
    for (const rule of Array.from(rules)) {
      if (this.selectors.size >= MAX_SELECTORS) return;
      if (isStyleRule(rule)) {
        if (rule.selectorText && hasMaskUrl(rule)) this.selectors.add(rule.selectorText);
      } else if (isGroupingRule(rule)) {
        this.walk(rule.cssRules);
      }
    }
  }

  refresh(roots: ParentNode[]): boolean {
    if (this.selectors.size === 0) return false;
    const all = [...this.selectors];
    let added = false;
    const take = (el: Element): void => {
      if (this.reps.size >= MAX_SIGNATURES) return;
      const sig = signature(el);
      if (this.reps.has(sig)) return;
      this.reps.set(sig, el);
      added = true;
    };
    const query = (root: ParentNode, sel: string): boolean => {
      try {
        root.querySelectorAll(sel).forEach(take);
        return true;
      } catch {
        return false;
      }
    };
    for (const root of roots) {
      for (let i = 0; i < all.length; i += CHUNK) {
        const chunk = all.slice(i, i + CHUNK);
        if (query(root, chunk.join(','))) continue;
        for (const sel of chunk) query(root, sel);
      }
    }
    if (added) this.cache.clear();
    return added;
  }

  isMaskRule(selector: string): boolean {
    const hit = this.cache.get(selector);
    if (hit !== undefined) return hit;
    let result = false;
    for (const el of this.reps.values()) {
      try {
        if (el.matches(selector)) {
          result = true;
          break;
        }
      } catch {
        break;
      }
    }
    this.cache.set(selector, result);
    return result;
  }

  clear(): void {
    this.selectors.clear();
    this.reps.clear();
    this.cache.clear();
  }
}
