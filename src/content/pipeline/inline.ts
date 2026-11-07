import { parseColor } from '../../core/color';
import { isLinkSelector, mapDeclarationValue, mapValueWithRole, PROPERTY_ROLES, rewriteVarUses, SHORTHAND_ROLES, twinName } from '../../core/css/declarations';
import type { VarRoles } from '../../core/css/vars';
import type { ColorFn, Role, RuleContext } from '../../core/mapping/types';
import { varShorthands } from './sheets';

interface Decl { value: string; priority: string }

interface Touch {
  /** Exact `style` attribute before our first write; dropped once the page edits the element. */
  exact: string | null | undefined;
  /** Per colour property we replaced: the page's original declaration and the one we wrote. */
  props: Map<string, { orig: Decl; ours: Decl }>;
  /** Names of the per-role twins we set for inline definitions of mixed variables (also kept in `props`). */
  twins: Set<string>;
}

type InlineVars = Pick<VarRoles, 'roleOf' | 'rolesOf' | 'isMixed'>;

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

  apply(el: Element, fn: ColorFn, vars?: InlineVars): void {
    const st = (el as HTMLElement).style;
    if (!st) return;
    const attr = el.getAttribute('style');
    if (attr !== null && this.written.get(el) === attr) return; // echo of our own write
    let touch = this.touches.get(el);
    if (touch) {
      // The page edited the element since our write. Colours it left alone keep their saved
      // originals; a colour it set itself is its new original.
      touch.exact = undefined;
      for (const [prop, d] of touch.props) {
        if (sameDecl(st, prop, d.ours)) continue;
        touch.props.delete(prop);
        touch.twins.delete(prop);
      }
    }
    const tag = el.tagName.toLowerCase();
    const bg = touch?.props.get('background-color')?.orig.value ?? st.getPropertyValue('background-color');
    const ctx: RuleContext = { selector: tag, ...isLinkSelector(tag), pairedBg: (bg && parseColor(bg)) || undefined, vars };
    /** [property, value ('' removes it), original declaration, priority to write with] */
    const updates: Array<[string, string, Decl, string]> = [];
    const seen = new Set<string>(touch?.twins); // our twins are never definitions to consider
    const recolour = (value: string, role: Role, v: InlineVars): string | null => {
      const recoloured = mapValueWithRole(value, role, fn, ctx);
      return rewriteVarUses(recoloured ?? value, role, (n) => v.isMixed(n)) ?? recoloured;
    };
    const wanted = new Set<string>();
    // A mixed variable defined inline must override its twins too, else var(--x__dx-R, var(--x)) picks
    // an inherited twin. Twins are recomputed on every apply, so they follow page edits of the main value.
    const twins = (prop: string, orig: Decl, v: InlineVars): void => {
      if (!orig.value || !v.isMixed(prop)) return;
      for (const role of v.rolesOf(prop)) {
        const twin = twinName(prop, role);
        if (wanted.has(twin)) continue;
        wanted.add(twin);
        const value = recolour(orig.value, role, v) ?? orig.value;
        const prev = touch?.props.get(twin);
        if (prev && sameDecl(st, twin, { value: value.trim(), priority: orig.priority })) continue;
        updates.push([twin, value, prev?.orig ?? declOf(st, twin), orig.priority]);
      }
    };
    const consider = (prop: string): void => {
      if (seen.has(prop) || touch?.props.has(prop)) return;
      seen.add(prop);
      const orig = declOf(st, prop);
      let mapped: string | null;
      if (prop.startsWith('--')) {
        if (!vars) return;
        twins(prop, orig, vars);
        if (!/var\(\s*--/i.test(orig.value)) return;
        // Only declarations that use a mixed variable are ours; a plain recolour is out of scope here.
        mapped = rewriteVarUses(mapValueWithRole(orig.value, vars.roleOf(prop), fn, ctx) ?? orig.value, vars.roleOf(prop), (n) => vars.isMixed(n));
      } else mapped = mapDeclarationValue(prop, orig.value, fn, ctx);
      if (mapped !== null) updates.push([prop, mapped, orig, orig.priority]);
    };
    for (let i = 0; i < st.length; i++) {
      const prop = st.item(i);
      if (prop in PROPERTY_ROLES || prop.startsWith('--')) consider(prop);
    }
    for (const [shorthand] of varShorthands(st)) consider(shorthand);
    // A main variable already rewritten by us is skipped above, but its twins still follow it.
    if (vars && touch) {
      for (const [prop, d] of touch.props) if (prop.startsWith('--') && !touch.twins.has(prop)) twins(prop, d.orig, vars);
    }
    // Twins whose variable is gone (or no longer mixed): put back what was there.
    if (touch) {
      for (const twin of touch.twins) {
        if (wanted.has(twin)) continue;
        const d = touch.props.get(twin);
        if (d) updates.push([twin, d.orig.value, d.orig, d.orig.priority]);
      }
    }
    if (!updates.length) {
      if (!touch) return;
      if (!touch.props.size) this.forget(el);
      else this.written.set(el, attr ?? '');
      return;
    }
    if (!touch) {
      touch = { exact: attr, props: new Map(), twins: new Set() };
      this.touches.set(el, touch);
    }
    this.restored.delete(el);
    // Shorthands first: they reset their longhands, which must stay as the later (overriding) declarations.
    updates.sort((a, b) => shorthandRank(a[0]) - shorthandRank(b[0]));
    for (const [prop, value, , priority] of updates) {
      if (value === '') st.removeProperty(prop);
      else st.setProperty(prop, value, priority);
    }
    // Read back only after all writes: a later longhand can change how an earlier shorthand reads.
    for (const [prop, , orig] of updates) {
      if (!wanted.has(prop) && touch.twins.has(prop)) {
        touch.props.delete(prop); // a dropped twin: restored above
        touch.twins.delete(prop);
        continue;
      }
      touch.props.set(prop, { orig, ours: declOf(st, prop) });
      if (wanted.has(prop)) touch.twins.add(prop);
    }
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
