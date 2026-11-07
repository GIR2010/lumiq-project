// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MaskIndex } from './masks';
import { parseCssText } from './sheets';

describe('MaskIndex', () => {
  let idx: MaskIndex;
  beforeEach(() => {
    document.body.innerHTML = '';
    idx = new MaskIndex(document);
  });

  const setup = () => {
    document.body.innerHTML = '<span class="m btn__icon"></span>';
    expect(idx.collect(parseCssText('.m{-webkit-mask-image:url(a.svg)}'))).toBe(true);
    expect(idx.refresh([document])).toBe(true);
  };

  it('matches selectors of found mask elements only', () => {
    setup();
    expect(idx.isMaskRule('.btn__icon')).toBe(true);
    expect(idx.isMaskRule('.other')).toBe(false);
  });

  it('detects the mask, mask-image and -webkit-mask forms and ignores non-url masks', () => {
    const rules = parseCssText(
      '.a{mask-image:url(a.svg)} .b{mask:url(b.svg) no-repeat} .c{-webkit-mask:url(c.svg)} .d{mask-image:none} .e{color:red}',
    );
    idx.collect(rules);
    document.body.innerHTML = '<i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i><i class="e"></i>';
    idx.refresh([document]);
    expect(['.a', '.b', '.c'].map((s) => idx.isMaskRule(s))).toEqual([true, true, true]);
    expect(idx.isMaskRule('.d')).toBe(false);
    expect(idx.isMaskRule('.e')).toBe(false);
  });

  it('recurses into grouping rules', () => {
    idx.collect(parseCssText('@media (min-width:1px){.g{-webkit-mask-image:url(g.svg)}}'));
    document.body.innerHTML = '<b class="g"></b>';
    expect(idx.refresh([document])).toBe(true);
    expect(idx.isMaskRule('.g')).toBe(true);
  });

  it('refresh reports only new signatures', () => {
    setup();
    expect(idx.refresh([document])).toBe(false);
    document.body.insertAdjacentHTML('beforeend', '<span class="m other-icon"></span>');
    expect(idx.refresh([document])).toBe(true);
    expect(idx.isMaskRule('.other-icon')).toBe(true);
    expect(idx.refresh([document])).toBe(false);
  });

  it('same tag and classes in a different order is the same signature', () => {
    setup();
    document.body.insertAdjacentHTML('beforeend', '<span class="btn__icon m"></span>');
    expect(idx.refresh([document])).toBe(false);
  });

  it('is grow-only: removing elements neither triggers refresh nor forgets the rule', () => {
    setup();
    document.body.innerHTML = '';
    expect(idx.refresh([document])).toBe(false);
    expect(idx.isMaskRule('.btn__icon')).toBe(true);
  });

  it('collect returns true only when the selector set grew', () => {
    const rules = parseCssText('.m{mask-image:url(a.svg)}');
    expect(idx.collect(rules)).toBe(true);
    expect(idx.collect(rules)).toBe(false);
  });

  it('does not throw on invalid selectors and skips them without breaking valid ones', () => {
    idx.collect(parseCssText('.m{mask-image:url(a.svg)}'));
    document.body.innerHTML = '<span class="m"></span>';
    expect(idx.refresh([document])).toBe(true);
    expect(() => idx.isMaskRule('!!bad[')).not.toThrow();
    expect(idx.isMaskRule('!!bad[')).toBe(false);
  });

  it('a chunk containing an invalid selector falls back to one-by-one querying', () => {
    // Craft an invalid selector through a fake rule list.
    const fake = [
      { selectorText: 'a[', style: { getPropertyValue: () => 'url(x)' }, cssText: '' },
      { selectorText: '.ok', style: { getPropertyValue: () => 'url(x)' }, cssText: '' },
    ] as unknown as CSSRuleList;
    idx.collect(fake);
    document.body.innerHTML = '<span class="ok"></span>';
    expect(idx.refresh([document])).toBe(true);
    expect(idx.isMaskRule('.ok')).toBe(true);
  });

  it('clear resets everything', () => {
    setup();
    idx.clear();
    expect(idx.isMaskRule('.btn__icon')).toBe(false);
    expect(idx.refresh([document])).toBe(false);
    expect(idx.collect(parseCssText('.m{mask-image:url(a.svg)}'))).toBe(true);
  });

  it('caps selectors at 500', () => {
    let css = '';
    for (let i = 0; i < 520; i++) css += `.s${i}{mask-image:url(a.svg)}`;
    idx.collect(parseCssText(css));
    document.body.innerHTML = '<i class="s499"></i><i class="s500"></i>';
    idx.refresh([document]);
    expect(idx.isMaskRule('.s499')).toBe(true);
    expect(idx.isMaskRule('.s500')).toBe(false);
  });

  it('caps signatures at 300', () => {
    idx.collect(parseCssText('.x{mask-image:url(a.svg)}'));
    let html = '';
    for (let i = 0; i < 400; i++) html += `<i class="x c${i}"></i>`;
    document.body.innerHTML = html;
    idx.refresh([document]);
    let kept = 0;
    for (let i = 0; i < 400; i++) if (idx.isMaskRule(`.c${i}`)) kept++;
    expect(kept).toBe(300);
  });

  it('is full at 300 signatures and then refresh queries nothing', () => {
    idx.collect(parseCssText('.x{mask-image:url(a.svg)}'));
    let html = '';
    for (let i = 0; i < 300; i++) html += `<i class="x c${i}"></i>`;
    document.body.innerHTML = html;
    expect(idx.full).toBe(false);
    idx.refresh([document]);
    expect(idx.full).toBe(true);
    const spy = vi.spyOn(document, 'querySelectorAll');
    document.body.insertAdjacentHTML('beforeend', '<i class="x extra"></i>');
    expect(idx.refresh([document])).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    idx.clear();
    expect(idx.full).toBe(false);
  });

  it('recognises pseudo-element masks only for the same pseudo', () => {
    idx.collect(parseCssText('.icon::before{-webkit-mask-image:url(a.svg);background-color:red}'));
    document.body.innerHTML = '<span class="icon"></span>';
    expect(idx.refresh([document])).toBe(true);
    expect(idx.isMaskRule('.icon::before')).toBe(true);
    expect(idx.isMaskRule('.icon')).toBe(false);
    expect(idx.isMaskRule('.icon::after')).toBe(false);
  });

  it('handles the legacy single-colon :after', () => {
    idx.collect(parseCssText('.ic:after{mask-image:url(a.svg)}'));
    document.body.innerHTML = '<span class="ic"></span>';
    idx.refresh([document]);
    expect(idx.isMaskRule('.ic:after')).toBe(true);
    expect(idx.isMaskRule('.ic::after')).toBe(true);
    expect(idx.isMaskRule('.ic')).toBe(false);
  });

  it('finds the root element itself', () => {
    idx.collect(parseCssText('.m{mask-image:url(a.svg)}'));
    const el = document.createElement('span');
    el.className = 'm';
    document.body.appendChild(el);
    expect(idx.refresh([el])).toBe(true);
    expect(idx.isMaskRule('.m')).toBe(true);
  });

  it('ignores a bare pseudo-element selector without throwing', () => {
    idx.collect(parseCssText('::before{mask-image:url(a.svg)}'));
    document.body.innerHTML = '<span></span>';
    expect(() => idx.refresh([document])).not.toThrow();
    expect(idx.isMaskRule('::before')).toBe(false);
  });

  it('refresh with no roots defaults to the document', () => {
    idx.collect(parseCssText('.m{mask-image:url(a.svg)}'));
    document.body.innerHTML = '<span class="m"></span>';
    expect(idx.refresh([])).toBe(true);
  });
  it('ignores user-action pseudo-classes of the host (hover, focus, active)', () => {
    document.body.innerHTML = '<button class="btn"><span class="m btn__icon"></span></button>';
    idx.collect(parseCssText('.m{-webkit-mask-image:url(a.svg)}'));
    expect(idx.refresh([document])).toBe(true);
    expect(idx.isMaskRule('.btn:hover .btn__icon')).toBe(true);
    expect(idx.isMaskRule('.btn:focus-visible > .btn__icon:active')).toBe(true);
    expect(idx.isMaskRule('.btn:focus-within :hover')).toBe(true);
    expect(idx.isMaskRule('.btn__icon:not(.m:hover)')).toBe(true); // inside :not() left as is
    expect(idx.isMaskRule('.other:hover')).toBe(false);
  });

  it('collects mask selectors whose host has a user-action pseudo-class', () => {
    document.body.innerHTML = '<a class="lnk"><i class="ic"></i></a>';
    idx.collect(parseCssText('.lnk:hover .ic{mask-image:url(a.svg)}'));
    expect(idx.refresh([document])).toBe(true);
    expect(idx.isMaskRule('.ic')).toBe(true);
  });
});
