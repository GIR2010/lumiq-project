import { parseColor } from '../../core/color';
import { isLinkSelector, mapDeclarationValue, mapValueWithRole, PROPERTY_ROLES, rewriteVarUses, SHORTHAND_ROLES } from '../../core/css/declarations';
import type { VarRoles } from '../../core/css/vars';
import type { ColorFn, RuleContext } from '../../core/mapping/types';
import { varShorthands } from './sheets';

interface Decl { value: string; priority: string }

interface Touch {
  /** Exact `style` attribute before our first write; dropped once the page edits the element. */
  exact: string | null | undefined;
  /** Per colour property we replaced: the page's original declaration and the one we wrote. */
  props: Map<string, { orig: Decl; ours: Decl }>;
}

const declOf = (st: CSSStyleDeclaration, prop: string): Decl => ({
  value: st.getPropertyValue(prop),
  priority: st.getPropertyPriority(prop),
});

const sameDecl = (st: CSSStyleDeclaration, prop: string, d: Decl): boolean =>
  st.getPropertyValue(prop) === d.value && st.getPropertyPriority(prop) === d.priority;

const shorthandRank = (prop: string): number => (Object.hasOwn(SHORTHAND_ROLES, prop) ? 0 : 1);

export class InlineStyler {
  private touches = new Map<Element, Touch>();
  /** Attribute value we last wrote per element; a mutation that leaves this value is ours. */
  private written = new WeakMap<Element, string>();
  /** Attribute value (null = removed) set by restoreAll, so its mutation record is recognised as ours. */
  private restored = new Map<Element, string | null>();

  apply(el: Element, fn: ColorFn, vars?: Pick<VarRoles, 'roleOf' | 'isMixed'>): void {
    const st = (el as HTMLElement).style;
    if (!st) return;
    const attr = el.getAttribute('style');
    if (attr !== null && this.written.get(el) === attr) return; // echo of our own write
    let touch = this.touches.get(el);
    if (touch) {
      // The page edited the element since our write. Colours it left alone keep their saved
      // originals; a colour it set itself is its new original.
      touch.exact = undefined;
      for (const [prop, d] of touch.props) if (!sameDecl(st, prop, d.ours)) touch.props.delete(prop);
    }
    const tag = el.tagName.toLowerCase();
    const bg = touch?.props.get('background-color')?.orig.value ?? st.getPropertyValue('background-color');
    const ctx: RuleContext = { selector: tag, ...isLinkSelector(tag), pairedBg: (bg && parseColor(bg)) || undefined, vars };
    const updates: Array<[string, string, Decl]> = [];
    const seen = new Set<string>();
    const consider = (prop: string): void => {
      if (seen.has(prop) || touch?.props.has(prop)) return;
      seen.add(prop);
      const orig = declOf(st, prop);
      let mapped: string | null;
      if (prop.startsWith('--')) {
        if (!vars || !/var\(\s*--/i.test(orig.value)) return;
        const role = vars.roleOf(prop);
        const recoloured = mapValueWithRole(orig.value, role, fn, ctx);
        // Only declarations that use a mixed variable are ours; a plain recolour is out of scope here.
        mapped = rewriteVarUses(recoloured ?? orig.value, role, (n) => vars.isMixed(n));
      } else mapped = mapDeclarationValue(prop, orig.value, fn, ctx);
      if (mapped !== null) updates.push([prop, mapped, orig]);
    };
    for (let i = 0; i < st.length; i++) {
      const prop = st.item(i);
      if (prop in PROPERTY_ROLES || prop.startsWith('--')) consider(prop);
    }
    for (const [shorthand] of varShorthands(st)) consider(shorthand);
    if (!updates.length) {
      if (!touch) return;
      if (!touch.props.size) this.forget(el);
      else this.written.set(el, attr ?? '');
      return;
    }
    if (!touch) {
      touch = { exact: attr, props: new Map() };
      this.touches.set(el, touch);
    }
    this.restored.delete(el);
    // Shorthands first: they reset their longhands, which must stay as the later (overriding) declarations.
    updates.sort((a, b) => shorthandRank(a[0]) - shorthandRank(b[0]));
    for (const [prop, value, orig] of updates) st.setProperty(prop, value, orig.priority);
    // Read back only after all writes: a later longhand can change how an earlier shorthand reads.
    for (const [prop, , orig] of updates) touch.props.set(prop, { orig, ours: declOf(st, prop) });
    this.written.set(el, el.getAttribute('style') ?? '');
  }

  restoreAll(): void {
    for (const [el, t] of this.touches) {
      const cur = el.getAttribute('style');
      const untouchedByPage = t.exact !== undefined && cur !== null && cur === this.written.get(el);
      this.written.delete(el);
      if (untouchedByPage) {
        const orig = t.exact ?? null;
        this.restored.set(el, orig);
        if (orig === null) el.removeAttribute('style');
        else el.setAttribute('style', orig);
        continue;
      }
      // The page edited the element: keep its current declarations, put back only our colours.
      const st = (el as HTMLElement).style;
      const entries = [...t.props].sort((a, b) => shorthandRank(a[0]) - shorthandRank(b[0]));
      // Decide what is still ours before writing: restoring a shorthand resets its longhands.
      const mine = entries.filter(([prop, d]) => sameDecl(st, prop, d.ours)); // else the page set it itself
      for (const [prop, d] of mine) {
        if (d.orig.value === '') st.removeProperty(prop);
        else st.setProperty(prop, d.orig.value, d.orig.priority);
      }
      this.restored.set(el, el.getAttribute('style'));
    }
    this.touches.clear();
  }

  isOwnMutation(r: MutationRecord): boolean {
    if (r.type !== 'attributes' || r.attributeName !== 'style') return false;
    const el = r.target as Element;
    const cur = el.getAttribute('style');
    if (this.written.get(el) === cur) return true;
    return this.restored.has(el) && this.restored.get(el) === cur;
  }

  private forget(el: Element): void {
    this.touches.delete(el);
    this.written.delete(el);
  }
}
