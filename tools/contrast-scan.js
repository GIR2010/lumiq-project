// Contrast scan: finds visible text and icons with WCAG contrast < 3 against their effective background.
// Usage: paste into the page console (or run through Claude in Chrome's javascript tool) after the
// extension has finished (wait ~5 s). Returns a summary; contains no page text, only tags/classes/colours.
(() => {
  const own = [...document.querySelectorAll('[data-darkext]')].map((e) => e.dataset.darkext)
    .reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {});
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\/]+/).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const effBg = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const rulesFor = (el, props) => {
    const r = [];
    const walk = (rs, isOwn) => {
      for (const x of rs) {
        if (x.cssRules && !x.selectorText) { walk(x.cssRules, isOwn); continue; }
        if (!x.selectorText) continue;
        let ok = false;
        try { ok = el.matches(x.selectorText.replace(/::?[a-z-]+(\([^)]*\))?/gi, '')); } catch {}
        if (!ok) continue;
        for (const p of props) {
          const v = x.style.getPropertyValue(p);
          if (v) r.push((isOwn ? '[OWN] ' : '') + x.selectorText.slice(0, 50) + ' { ' + p + ': ' + v.slice(0, 90) + ' }');
        }
      }
    };
    for (const s of document.styleSheets) {
      try { walk(s.cssRules, !!s.ownerNode?.dataset?.darkext); } catch {}
    }
    return r.slice(-4);
  };
  const visible = (el) => {
    const b = el.getBoundingClientRect();
    return b.width > 4 && b.height > 4 && b.bottom > 0 && b.top < innerHeight * 3;
  };
  const groups = new Map();
  for (const el of document.querySelectorAll('body *')) {
    const tag = el.tagName.toLowerCase();
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    const isIcon = tag === 'svg' || tag === 'i';
    if (!hasText && !isIcon) continue;
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const fg = parse(tag === 'svg' && cs.fill.startsWith('rgb') ? cs.fill : cs.color);
    if (!fg || fg.a < 0.3) continue;
    const bg = effBg(el);
    const c = contrast(fg, bg);
    if (c >= 3) continue;
    const key = (isIcon ? 'ICON ' : 'TEXT ') + tag + '.' + String(el.className?.baseVal ?? el.className).split(/\s+/).slice(0, 2).join('.') + ' ' + cs.color;
    const g = groups.get(key) || { key, n: 0, contrast: c, bg: `rgb(${bg.r},${bg.g},${bg.b})`, el };
    g.n++;
    groups.set(key, g);
  }
  const top = [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 12)
    .map((g) => ({ key: g.key, n: g.n, contrast: +g.contrast.toFixed(2), bg: g.bg, rules: rulesFor(g.el, ['color', 'fill']) }));
  const total = [...groups.values()].reduce((s, g) => s + g.n, 0);
  return { own, groups: groups.size, elements: total, top };
})();
