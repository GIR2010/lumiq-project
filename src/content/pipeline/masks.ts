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

const PSEUDO_RE = /(::(?!slotted\(|part\()[-\w]+|:(?:before|after))(?![-\w(])\s*$/i;

/** Splits a selector list on top-level commas. */
function splitList(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  out.push(selector.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

interface Part {
  host: string;
  pseudo: string; // '' or e.g. 'before'
}

/** Splits one selector (per comma part) into host selector + trailing pseudo-element. Bare pseudo-elements are dropped. */
function splitPseudo(selector: string): Part[] {
  const parts: Part[] = [];
  for (const part of splitList(selector)) {
    const m = PSEUDO_RE.exec(part);
    if (!m) {
      parts.push({ host: part, pseudo: '' });
      continue;
    }
    const host = part.slice(0, m.index).trim();
    if (!host) continue;
    parts.push({ host, pseudo: m[1].replace(/^:+/, '').toLowerCase() });
  }
  return parts;
}

function signature(el: Element, pseudo: string): string {
  return `${el.tagName.toLowerCase()}.${[...el.classList].sort().join('.')}${pseudo ? '::' + pseudo : ''}`;
}

interface Rep {
  el: Element;
  pseudo: string;
}

/** Index of elements painted with CSS masks (their background-color is an icon colour). Grow-only until clear(). */
export class MaskIndex {
  /** pseudo -> host selectors */
  private selectors = new Map<string, Set<string>>();
  private count = 0;
  private reps = new Map<string, Rep>();
  private cache = new Map<string, boolean>();

  constructor(private readonly doc: Document) {}

  collect(rules: CSSRuleList): boolean {
    const before = this.count;
    this.walk(rules);
    return this.count > before;
  }

  private walk(rules: CSSRuleList): void {
    for (const rule of Array.from(rules)) {
      if (this.count >= MAX_SELECTORS) return;
      if (isStyleRule(rule)) {
        if (rule.selectorText && hasMaskUrl(rule)) this.add(rule.selectorText);
      } else if (isGroupingRule(rule)) {
        this.walk(rule.cssRules);
      }
    }
  }

  private add(selector: string): void {
    for (const { host, pseudo } of splitPseudo(selector)) {
      if (this.count >= MAX_SELECTORS) return;
      let set = this.selectors.get(pseudo);
      if (!set) this.selectors.set(pseudo, (set = new Set()));
      if (!set.has(host)) {
        set.add(host);
        this.count++;
      }
    }
  }

  refresh(roots: ParentNode[]): boolean {
    if (this.count === 0) return false;
    const targets: ParentNode[] = roots.length ? roots : [this.doc];
    let added = false;
    for (const [pseudo, set] of this.selectors) {
      const all = [...set];
      const take = (el: Element): void => {
        if (this.reps.size >= MAX_SIGNATURES) return;
        const sig = signature(el, pseudo);
        if (this.reps.has(sig)) return;
        this.reps.set(sig, { el, pseudo });
        added = true;
      };
      const query = (root: ParentNode, sel: string): boolean => {
        try {
          root.querySelectorAll(sel).forEach(take);
          if (typeof (root as Element).matches === 'function' && (root as Element).matches(sel)) take(root as Element);
          return true;
        } catch {
          return false;
        }
      };
      for (const root of targets) {
        for (let i = 0; i < all.length; i += CHUNK) {
          const chunk = all.slice(i, i + CHUNK);
          if (query(root, chunk.join(','))) continue;
          for (const sel of chunk) query(root, sel);
        }
      }
    }
    if (added) this.cache.clear();
    return added;
  }

  isMaskRule(selector: string): boolean {
    const hit = this.cache.get(selector);
    if (hit !== undefined) return hit;
    let result = false;
    for (const { host, pseudo } of splitPseudo(selector)) {
      for (const rep of this.reps.values()) {
        if (rep.pseudo !== pseudo) continue;
        try {
          if (rep.el.matches(host)) {
            result = true;
            break;
          }
        } catch {
          break;
        }
      }
      if (result) break;
    }
    this.cache.set(selector, result);
    return result;
  }

  clear(): void {
    this.selectors.clear();
    this.count = 0;
    this.reps.clear();
    this.cache.clear();
  }
}
