/** Injected at document_start: paints a dark canvas until the controller decides. Must never throw. */
(() => {
  try {
    const root = document.documentElement;
    if (!root || document.querySelector('[data-darkext=placeholder]')) return;
    const rule = 'html{background-color:#1e1e1e!important;color:#e0e0e0!important}';
    const style = document.createElement('style');
    style.setAttribute('data-darkext', 'placeholder');
    style.textContent = __SYS__ ? `@media (prefers-color-scheme: dark){${rule}}` : rule;
    root.appendChild(style);
  } catch {
    // never break the page
  }
})();

export {};
