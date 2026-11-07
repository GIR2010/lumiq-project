type Kind = 'base' | 'mirror' | 'fallback';
type Source = Element | CSSStyleSheet;

export class StyleWriter {
  private base: HTMLStyleElement | null = null;
  private fallback: HTMLStyleElement | null = null;
  private mirrors = new Map<Source, HTMLStyleElement | CSSStyleSheet>();
  private adopted = new Map<CSSStyleSheet, Document | ShadowRoot>();
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

  setMirror(source: Source, css: string, root: Document | ShadowRoot = this.doc): void {
    const prev = this.mirrors.get(source);
    if (!(source instanceof Element)) {
      // Adopted (ownerless) sheet: mirror as a constructed sheet added to the root.
      let sheet = prev as CSSStyleSheet | undefined;
      if (!sheet) {
        sheet = new CSSStyleSheet();
        this.mirrors.set(source, sheet);
        this.adopted.set(sheet, root);
      }
      sheet.replaceSync(css);
      // Keep the mirror immediately after its source in the cascade order.
      const others = root.adoptedStyleSheets.filter((x) => x !== sheet);
      const at = others.indexOf(source);
      const next = at < 0 ? [...others, sheet] : [...others.slice(0, at + 1), sheet, ...others.slice(at + 1)];
      const cur = root.adoptedStyleSheets;
      if (next.length !== cur.length || next.some((x, i) => x !== cur[i])) root.adoptedStyleSheets = next;
      sheet.disabled = this.disabled;
      return;
    }
    let el = prev as HTMLStyleElement | undefined;
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

  removeMirror(source: Source): void {
    const m = this.mirrors.get(source);
    if (!m) return;
    this.mirrors.delete(source);
    this.dispose(m);
  }

  private dispose(m: HTMLStyleElement | CSSStyleSheet): void {
    if (m instanceof CSSStyleSheet) {
      const root = this.adopted.get(m);
      this.adopted.delete(m);
      if (root) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== m);
    } else {
      this.media.delete(m);
      m.remove();
    }
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    for (const m of [this.base, this.fallback, ...this.mirrors.values()]) {
      if (!m) continue;
      if (m instanceof CSSStyleSheet) m.disabled = disabled;
      else this.applyMedia(m);
    }
  }

  clear(): void {
    this.base?.remove();
    this.base = null;
    this.removeFallback();
    for (const m of this.mirrors.values()) this.dispose(m);
    this.mirrors.clear();
  }
}
