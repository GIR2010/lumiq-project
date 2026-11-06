/**
 * Main-world hook. Runs in the page's JS world at document_start and reports
 * shadow roots, adoptedStyleSheets assignments and stylesheet mutations to the
 * isolated-world content script via DOM events. Must never break the page.
 */

type Fn = (this: unknown, ...args: unknown[]) => unknown;

function dispatch(target: EventTarget | null | undefined, type: string, init: CustomEventInit = {}): void {
  try {
    (target ?? document).dispatchEvent(new CustomEvent(type, init));
  } catch {
    // never throw into page code
  }
}

/** Replace obj[key] (a method) with a wrapper, keeping descriptor flags, name and length. */
function wrapMethod(
  obj: object,
  key: string,
  after: (self: unknown, result: unknown) => void,
): void {
  try {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (!desc || typeof desc.value !== 'function') return;
    const orig = desc.value as Fn;
    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      const result = Reflect.apply(orig, this, args);
      try {
        after(this, result);
      } catch {
        // swallow
      }
      return result;
    };
    Object.defineProperty(wrapper, 'name', { value: orig.name, configurable: true });
    Object.defineProperty(wrapper, 'length', { value: orig.length, configurable: true });
    Object.defineProperty(obj, key, { ...desc, value: wrapper });
  } catch {
    // leave original in place
  }
}

function wrapAdoptedSetter(proto: object | undefined, targetOf: (self: unknown) => EventTarget | null): void {
  try {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, 'adoptedStyleSheets');
    if (!desc || !desc.set) return;
    const origSet = desc.set;
    const set = function (this: unknown, value: unknown): void {
      Reflect.apply(origSet, this, [value]);
      try {
        dispatch(targetOf(this), 'darkext:adopted');
      } catch {
        // swallow
      }
    };
    Object.defineProperty(set, 'name', { value: origSet.name, configurable: true });
    Object.defineProperty(set, 'length', { value: origSet.length, configurable: true });
    Object.defineProperty(proto, 'adoptedStyleSheets', { ...desc, set });
  } catch {
    // leave original in place
  }
}

function install(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__darkextHooked) return;
  Object.defineProperty(w, '__darkextHooked', { value: true, enumerable: false, configurable: true });

  wrapMethod(Element.prototype, 'attachShadow', (self, root) => {
    if ((root as ShadowRoot | null)?.mode === 'open') {
      dispatch(self as Element, 'darkext:shadow', { bubbles: true, composed: true });
    }
  });

  if (typeof CSSStyleSheet !== 'undefined') {
    const pending = new WeakSet<object>();
    const notify = (sheet: unknown): void => {
      if (!sheet || typeof sheet !== 'object' || pending.has(sheet)) return;
      pending.add(sheet);
      queueMicrotask(() => {
        pending.delete(sheet);
        dispatch((sheet as CSSStyleSheet).ownerNode, 'darkext:sheet-changed');
      });
    };
    for (const m of ['insertRule', 'deleteRule', 'replace', 'replaceSync']) {
      if (m in CSSStyleSheet.prototype) wrapMethod(CSSStyleSheet.prototype, m, (self) => notify(self));
    }
  }

  wrapAdoptedSetter(typeof Document !== 'undefined' ? Document.prototype : undefined, () => document);
  wrapAdoptedSetter(typeof ShadowRoot !== 'undefined' ? ShadowRoot.prototype : undefined, (self) => (self as ShadowRoot).host);
}

try {
  install();
} catch {
  // never break the page
}

export {};
