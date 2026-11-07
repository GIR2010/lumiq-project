export interface ObserverHandlers {
  onSheetNode(n: HTMLStyleElement | HTMLLinkElement): void;
  onSheetNodeRemoved(n: Element): void;
  onStyleAttr(el: Element): void;
  isOwn(r: MutationRecord): boolean;
  /** Document roots only: children of <html>/<head> changed (e.g. <head> appeared, a node went before base). */
  onHeadChange?(): void;
  /** Called after each batch has been delivered. */
  onFlushed?(): void;
}

/** Attributes that change which sheet a <link>/<style> provides, or how it applies. */
const SHEET_ATTRS = ['href', 'media', 'rel', 'disabled', 'type'];

export function isOwnNode(n: Node | null | undefined): boolean {
  return !!n && n.nodeType === Node.ELEMENT_NODE && (n as Element).hasAttribute('data-darkext');
}

export function isStylesheetLink(el: Element): el is HTMLLinkElement {
  return el.localName === 'link' && /(?:^|\s)stylesheet(?:\s|$)/i.test(el.getAttribute('rel') ?? '');
}

export function isSheetNode(el: Element): el is HTMLStyleElement | HTMLLinkElement {
  return el.localName === 'style' || isStylesheetLink(el);
}

const isStyleOrLink = (el: Element) => el.localName === 'style' || el.localName === 'link';

/** Runs `cb` on the next animation frame (a timer where there are no frames); returns a cancel function. */
export function scheduleFrame(cb: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => cb());
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(cb, 16);
  return () => clearTimeout(id);
}

/** Watches a document or shadow root; mutations are batched and delivered once per animation frame. */
export function observeRoot(root: Document | ShadowRoot, h: ObserverHandlers): () => void {
  const doc = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : null;
  const sheets = new Set<HTMLStyleElement | HTMLLinkElement>();
  const removed = new Set<Element>();
  const styled = new Set<Element>();
  let headChanged = false;
  let cancel: (() => void) | null = null;

  const added = (el: Element) => {
    if (isOwnNode(el)) return;
    if (isSheetNode(el)) sheets.add(el);
    if (el.hasAttribute('style')) styled.add(el);
    if (!el.firstElementChild) return;
    for (const d of Array.from(el.querySelectorAll('style, link, [style]'))) {
      if (isOwnNode(d)) continue;
      if (isSheetNode(d)) sheets.add(d);
      if (d.hasAttribute('style')) styled.add(d);
    }
  };

  const gone = (el: Element) => {
    if (isOwnNode(el)) return;
    if (isStyleOrLink(el)) removed.add(el);
    if (el.firstElementChild) for (const d of Array.from(el.querySelectorAll('style, link'))) removed.add(d);
  };

  const flush = () => {
    cancel = null;
    const rem = [...removed], sh = [...sheets], st = [...styled], head = headChanged;
    removed.clear(); sheets.clear(); styled.clear(); headChanged = false;
    for (const el of rem) if (!el.isConnected) h.onSheetNodeRemoved(el);
    for (const el of sh) if (el.isConnected) h.onSheetNode(el);
    for (const el of st) if (el.isConnected) h.onStyleAttr(el);
    if (head) h.onHeadChange?.();
    h.onFlushed?.();
  };

  const collect = (records: MutationRecord[]) => {
    for (const r of records) {
      if (h.isOwn(r)) continue;
      const t = r.target;
      if (r.type === 'attributes') {
        const el = t as Element;
        if (isOwnNode(el)) continue;
        if (r.attributeName === 'style') styled.add(el);
        else if (el.localName === 'style' || el.localName === 'link') sheets.add(el as HTMLStyleElement | HTMLLinkElement);
      } else if (r.type === 'characterData') {
        const p = t.parentElement;
        if (p && p.localName === 'style' && !isOwnNode(p)) sheets.add(p as HTMLStyleElement);
      } else {
        if (doc && (t === doc.documentElement || t === doc.head)) headChanged = true;
        if (t.nodeType === Node.ELEMENT_NODE && (t as Element).localName === 'style') {
          if (!isOwnNode(t)) sheets.add(t as HTMLStyleElement);
          continue;
        }
        for (const n of Array.from(r.addedNodes)) if (n.nodeType === Node.ELEMENT_NODE) added(n as Element);
        for (const n of Array.from(r.removedNodes)) if (n.nodeType === Node.ELEMENT_NODE) gone(n as Element);
      }
    }
    if (!cancel && (sheets.size || removed.size || styled.size || headChanged)) cancel = scheduleFrame(flush);
  };

  const mo = new MutationObserver(collect);
  mo.observe(root, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['style', ...SHEET_ATTRS],
  });

  return () => {
    mo.takeRecords();
    mo.disconnect();
    cancel?.();
    cancel = null;
    sheets.clear(); removed.clear(); styled.clear(); headChanged = false;
  };
}
