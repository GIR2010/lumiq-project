import { parseColor } from '../../core/color';
import { isLinkSelector, mapDeclarationValue, PROPERTY_ROLES } from '../../core/css/declarations';
import type { ColorFn, RuleContext } from '../../core/mapping/types';

export class InlineStyler {
  /** Original `style` attribute text, captured before our first write. */
  private originals = new WeakMap<Element, string>();
  private touched = new Set<Element>();
  /** Attribute value we last wrote per element; a mutation that leaves this value is ours. */
  private written = new WeakMap<Element, string>();

  apply(el: Element, fn: ColorFn): void {
    const st = (el as HTMLElement).style;
    if (!st || !el.hasAttribute('style')) return;
    const attr = el.getAttribute('style') ?? '';
    if (this.written.get(el) === attr) return; // echo of our own write
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
    for (const [prop, value, prio] of updates) st.setProperty(prop, value, prio);
    this.written.set(el, el.getAttribute('style') ?? '');
  }

  restoreAll(): void {
    for (const el of this.touched) {
      el.setAttribute('style', this.originals.get(el) ?? '');
      this.written.delete(el);
    }
    this.touched.clear();
  }

  isOwnMutation(r: MutationRecord): boolean {
    if (r.type !== 'attributes' || r.attributeName !== 'style') return false;
    const el = r.target as Element;
    return this.written.get(el) === el.getAttribute('style');
  }
}
