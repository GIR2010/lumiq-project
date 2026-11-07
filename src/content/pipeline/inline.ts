import { parseColor } from '../../core/color';
import { isLinkSelector, mapDeclarationValue, PROPERTY_ROLES } from '../../core/css/declarations';
import type { ColorFn, RuleContext } from '../../core/mapping/types';

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

export class InlineStyler {
  private touches = new Map<Element, Touch>();
  /** Attribute value we last wrote per element; a mutation that leaves this value is ours. */
  private written = new WeakMap<Element, string>();
  /** Attribute value (null = removed) set by restoreAll, so its mutation record is recognised as ours. */
  private restored = new Map<Element, string | null>();

  apply(el: Element, fn: ColorFn): void {
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
    const ctx: RuleContext = { selector: tag, ...isLinkSelector(tag), pairedBg: (bg && parseColor(bg)) || undefined };
    const updates: Array<[string, string, Decl]> = [];
    for (let i = 0; i < st.length; i++) {
      const prop = st.item(i);
      if (!(prop in PROPERTY_ROLES) || touch?.props.has(prop)) continue;
      const orig = declOf(st, prop);
      const mapped = mapDeclarationValue(prop, orig.value, fn, ctx);
      if (mapped !== null) updates.push([prop, mapped, orig]);
    }
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
    for (const [prop, value, orig] of updates) {
      st.setProperty(prop, value, orig.priority);
      touch.props.set(prop, { orig, ours: declOf(st, prop) });
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
      for (const [prop, d] of t.props) {
        if (!sameDecl(st, prop, d.ours)) continue; // the page set this colour itself
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
