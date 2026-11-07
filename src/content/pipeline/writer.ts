type Kind = 'base' | 'mirror' | 'fallback';
type Source = Element | CSSStyleSheet;
type Root = Document | ShadowRoot;
/** Mirror of an adopted (ownerless) sheet: one constructed sheet, adopted into every root holding the source. */
interface AdoptedMirror { sheet: CSSStyleSheet; roots: Set<Root> }

export class StyleWriter {
  private base: HTMLStyleElement | null = null;
  private fallback: HTMLStyleElement | null = null;
  private mirrors = new Map<Element, HTMLStyleElement>();
  private adopted = new Map<CSSStyleSheet, AdoptedMirror>();
  /** Our own constructed sheets: never to be treated as page sheets. */
  private own = new WeakSet<CSSStyleSheet>();
  private disabled = false;
  /** The `media` each mirror element should have when enabled (copied from its source). */
  private media = new Map<HTMLStyleElement, string | null>();

  constructor(private doc: Document) {}

  private make(kind: Kind, css: string): HTMLStyleElement {
    const el = this.doc.createElement('style');
    el.setAttribute('data-darkext', kind);
    el.textContent = css;
    return el;
  }

  private applyMedia(el: HTMLStyleElement): void {
    const wanted = this.disabled ? 'not all' : (this.media.get(el) ?? null);
    if (wanted === null) el.removeAttribute('media');
    else el.setAttribute('media', wanted);
  }

  /** Puts base first in <head> (or documentElement while there is no head); moves it into head once it appears. */
  ensureBaseFirst(): void {
    const el = this.base;
    if (!el) return;
    const parent: Element | null = this.doc.head ?? this.doc.documentElement;
    if (!parent) return;
    if (el.parentNode !== parent || parent.firstElementChild !== el) parent.insertBefore(el, parent.firstChild);
  }

  setBase(css: string): void {
    if (!this.base) this.base = this.make('base', css);
    else this.base.textContent = css;
    this.applyMedia(this.base);
    this.ensureBaseFirst();
  }

  /** Content-controlled anti-flash style (replaces the placeholder until the page's sheets are mirrored). */
  setFallback(css: string): void {
    if (!this.fallback) this.fallback = this.make('fallback', css);
    else this.fallback.textContent = css;
    this.applyMedia(this.fallback);
    if (!this.fallback.isConnected) (this.doc.head ?? this.doc.documentElement)?.appendChild(this.fallback);
  }

  hasFallback(): boolean {
    return this.fallback !== null;
  }

  removeFallback(): void {
    this.fallback?.remove();
    this.fallback = null;
  }

  owns(sheet: CSSStyleSheet): boolean {
    return this.own.has(sheet);
  }

  /** `roots`: for an adopted source, every root whose adoptedStyleSheets hold it (ignored for elements). */
  setMirror(source: Source, css: string, roots: Iterable<Root> = [this.doc]): void {
    if (!(source instanceof Element)) {
      this.setAdoptedMirror(source, css, new Set(roots));
      return;
    }
    let el = this.mirrors.get(source);
    if (!el) {
      el = this.make('mirror', css);
      this.mirrors.set(source, el);
    } else {
      el.textContent = css;
    }
    this.media.set(el, source.getAttribute('media'));
    this.applyMedia(el);
    if (el.previousSibling !== source || el.parentNode !== source.parentNode) {
      source.parentNode?.insertBefore(el, source.nextSibling);
    }
  }

  private setAdoptedMirror(source: CSSStyleSheet, css: string, roots: Set<Root>): void {
    let m = this.adopted.get(source);
    if (!m) {
      m = { sheet: new CSSStyleSheet(), roots: new Set() };
      this.own.add(m.sheet);
      this.adopted.set(source, m);
    }
    m.sheet.replaceSync(css);
    m.sheet.disabled = this.disabled;
    for (const r of m.roots) if (!roots.has(r)) unadopt(r, m.sheet);
    for (const r of roots) adoptAfter(r, source, m.sheet);
    m.roots = roots;
  }

  /** The root no longer holds the adopted source: its copy of the mirror goes. */
  dropRoot(source: CSSStyleSheet, root: Root): void {
    const m = this.adopted.get(source);
    if (!m || !m.roots.delete(root)) return;
    unadopt(root, m.sheet);
  }

  removeMirror(source: Source): void {
    if (source instanceof Element) {
      const el = this.mirrors.get(source);
      if (!el) return;
      this.mirrors.delete(source);
      this.media.delete(el);
      el.remove();
      return;
    }
    const m = this.adopted.get(source);
    if (!m) return;
    this.adopted.delete(source);
    for (const r of m.roots) unadopt(r, m.sheet);
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    for (const el of [this.base, this.fallback, ...this.mirrors.values()]) if (el) this.applyMedia(el);
    for (const m of this.adopted.values()) m.sheet.disabled = disabled;
  }

  clear(): void {
    this.base?.remove();
    this.base = null;
    this.removeFallback();
    for (const source of [...this.mirrors.keys(), ...this.adopted.keys()]) this.removeMirror(source);
  }
}

/** Keeps the mirror immediately after its source in the root's cascade order. */
function adoptAfter(root: Root, source: CSSStyleSheet, sheet: CSSStyleSheet): void {
  const cur = root.adoptedStyleSheets;
  const others = cur.filter((x) => x !== sheet);
  const at = others.indexOf(source);
  const next = at < 0 ? [...others, sheet] : [...others.slice(0, at + 1), sheet, ...others.slice(at + 1)];
  if (next.length !== cur.length || next.some((x, i) => x !== cur[i])) root.adoptedStyleSheets = next;
}

function unadopt(root: Root, sheet: CSSStyleSheet): void {
  if (root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
}
