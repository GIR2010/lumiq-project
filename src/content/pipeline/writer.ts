type Kind = 'base' | 'mirror';
type Source = Element | CSSStyleSheet;

export class StyleWriter {
  private base: HTMLStyleElement | null = null;
  private mirrors = new Map<Source, HTMLStyleElement | CSSStyleSheet>();
  private adopted = new Map<CSSStyleSheet, Document | ShadowRoot>();
  private disabled = false;

  constructor(private doc: Document) {}

  private make(kind: Kind, css: string): HTMLStyleElement {
    const el = this.doc.createElement('style');
    el.setAttribute('data-darkext', kind);
    el.textContent = css;
    if (this.disabled) el.setAttribute('media', 'not all');
    return el;
  }

  /** Puts base first in <head> (or documentElement while there is no head); moves it into head once it appears. */
  private ensureHead(): void {
    const el = this.base;
    if (!el) return;
    const parent: Element | null = this.doc.head ?? this.doc.documentElement;
    if (!parent) return;
    if (el.parentNode !== parent || parent.firstElementChild !== el) parent.insertBefore(el, parent.firstChild);
  }

  setBase(css: string): void {
    if (!this.base) this.base = this.make('base', css);
    else this.base.textContent = css;
    this.ensureHead();
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
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      }
      sheet.replaceSync(css);
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
      m.remove();
    }
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    for (const m of [this.base, ...this.mirrors.values()]) {
      if (!m) continue;
      if (m instanceof CSSStyleSheet) m.disabled = disabled;
      else if (disabled) m.setAttribute('media', 'not all');
      else m.removeAttribute('media');
    }
  }

  clear(): void {
    this.base?.remove();
    this.base = null;
    for (const m of this.mirrors.values()) this.dispose(m);
    this.mirrors.clear();
  }
}
