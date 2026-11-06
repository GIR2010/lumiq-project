import { parseColor } from '../../core/color';
import { isLinkSelector, mapDeclarationValue, PROPERTY_ROLES } from '../../core/css/declarations';
import type { ColorFn, RuleContext } from '../../core/mapping/types';

export class InlineStyler {
  /** Original `style` attribute text, captured before our first write. */
  private originals = new WeakMap<Element, string | null>();
  private touched = new Set<Element>();
  /** Attribute value we last wrote per element; a mutation that leaves this value is ours. */
  private written = new WeakMap<Element, string>();
  /** Attribute value (null = removed) set by restoreAll, so its mutation record is recognised as ours. */
  private restored = new Map<Element, string | null>();

  apply(el: Element, fn: ColorFn): void {
    const st = (el as HTMLElement).style;
    if (!st) return;
    const attr = el.getAttribute('style');
    if (attr !== null && this.written.get(el) === attr) return; // echo of our own write
    // The page rewrote the attribute since we touched it: its value is the new original.
    if (this.touched.has(el)) this.originals.set(el, attr);
    if (attr === null) return;
    const tag = el.tagName.toLowerCase();
    const bg = st.getPropertyValue('background-color');
    const ctx: RuleContext = { selector: tag, ...isLinkSelector(tag), pairedBg: (bg && parseColor(bg)) || undefined };
    const updates: Array<[string, string, string]> = [];
    for (let i = 0; i < st.length; i++) {
      const prop = st.item(i);
      if (!(prop in PROPERTY_ROLES)) continue;
      const mapped = mapDeclarationValue(prop, st.getPropertyValue(prop), fn, ctx);
      if (mapped !== null) updates.push([prop, mapped, st.getPropertyPriority(prop)]);
    }
    if (!updates.length) return;
    if (!this.touched.has(el)) this.originals.set(el, attr);
    this.touched.add(el);
    this.restored.delete(el);
    for (const [prop, value, prio] of updates) st.setProperty(prop, value, prio);
    this.written.set(el, el.getAttribute('style') ?? '');
  }

  restoreAll(): void {
    for (const el of this.touched) {
      const orig = this.originals.get(el) ?? null;
      this.written.delete(el);
      this.restored.set(el, orig);
      if (orig === null) el.removeAttribute('style');
      else el.setAttribute('style', orig);
    }
    this.touched.clear();
  }

  isOwnMutation(r: MutationRecord): boolean {
    if (r.type !== 'attributes' || r.attributeName !== 'style') return false;
    const el = r.target as Element;
    const cur = el.getAttribute('style');
    if (this.written.get(el) === cur) return true;
    return this.restored.has(el) && this.restored.get(el) === cur;
  }
}
