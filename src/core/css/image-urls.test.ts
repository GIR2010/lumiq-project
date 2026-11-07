import { describe, expect, it } from 'vitest';
import { IMAGE_PROPS, replaceImageUrl, singleImageUrl } from './image-urls';

describe('singleImageUrl', () => {
  it('IMAGE_PROPS', () => {
    expect([...IMAGE_PROPS]).toEqual([
      'background-image', 'background', 'list-style-image', 'list-style', 'content',
    ]);
  });
  it('в кавычках', () =>
    expect(singleImageUrl('list-style-image', 'url("https://a/x.gif")')).toBe('https://a/x.gif'));
  it('в одинарных кавычках', () =>
    expect(singleImageUrl('background-image', "url( 'a.png' )")).toBe('a.png'));
  it('сокращение с прочими токенами', () =>
    expect(singleImageUrl('background', 'url(a.png) no-repeat 0 0')).toBe('a.png'));
  it('цвет с запятыми внутри скобок допустим', () =>
    expect(singleImageUrl('background', 'rgb(1, 2, 3) url(a.png)')).toBe('a.png'));
  it('градиент -> null', () =>
    expect(singleImageUrl('background-image', 'linear-gradient(#fff,#000)')).toBeNull());
  it('url вместе с градиентом -> null', () =>
    expect(singleImageUrl('background', 'url(a.png), linear-gradient(#fff,#000)')).toBeNull());
  it('url внутри градиентной функции -> null', () =>
    expect(singleImageUrl('background', 'repeating-radial-gradient(red, blue) url(a.png)')).toBeNull());
  it('image-set -> null', () =>
    expect(singleImageUrl('background-image', 'image-set("a.png" 1x, "b.png" 2x)')).toBeNull());
  it('несколько слоёв -> null', () => {
    expect(singleImageUrl('background-image', 'url(a.png), url(b.png)')).toBeNull();
    expect(singleImageUrl('background', 'url(a.png), url(b.png)')).toBeNull();
  });
  it('два url без запятой -> null', () =>
    expect(singleImageUrl('background', 'url(a.png) url(b.png)')).toBeNull());
  it('нет url -> null', () => {
    expect(singleImageUrl('background', 'red')).toBeNull();
    expect(singleImageUrl('background-image', 'none')).toBeNull();
  });
  it('неизвестное свойство -> null', () =>
    expect(singleImageUrl('color', 'url(a.png)')).toBeNull());
  it('content: целиком url', () => {
    expect(singleImageUrl('content', 'url(a.svg)')).toBe('a.svg');
    expect(singleImageUrl('content', '  url(a.svg) ')).toBe('a.svg');
  });
  it('content: прочие токены -> null', () => {
    expect(singleImageUrl('content', '"x" url(a.svg)')).toBeNull();
    expect(singleImageUrl('content', 'url(a.svg) "x"')).toBeNull();
  });
  it('скобки и кавычки внутри URL', () => {
    expect(singleImageUrl('background', 'url("a(1).png")')).toBe('a(1).png');
    expect(singleImageUrl('background', 'url(a\\)b.png)')).toBe('a)b.png');
    expect(singleImageUrl('background', 'url("a\\"b.png")')).toBe('a"b.png');
  });
  it('hex-escape', () =>
    expect(singleImageUrl('background', 'url(a\\29 b.png)')).toBe('a)b.png'));
  it('регистр URL()', () =>
    expect(singleImageUrl('background', 'URL(a.png)')).toBe('a.png'));
  it('data: URL с запятой', () =>
    expect(singleImageUrl('background', 'url("data:image/png;base64,AA==")')).toBe('data:image/png;base64,AA=='));
  it('незакрытый url -> null', () =>
    expect(singleImageUrl('background', 'url(a.png')).toBeNull());
});

describe('replaceImageUrl', () => {
  it('подменяет аргумент, остальное сохраняет', () =>
    expect(replaceImageUrl('url(a.png) no-repeat', 'a.png', 'data:image/png;base64,AA'))
      .toBe('url("data:image/png;base64,AA") no-repeat'));
  it('кавычная форма', () =>
    expect(replaceImageUrl('0 0 / 5px url( "a.png" )  red', 'a.png', 'x')).toBe('0 0 / 5px url("x")  red'));
  it('не найдено -> без изменений', () =>
    expect(replaceImageUrl('url(a.png)', 'b.png', 'x')).toBe('url(a.png)'));
  it('экранирует кавычки и обратный слеш в to', () =>
    expect(replaceImageUrl('url(a.png)', 'a.png', 'a"b\\c')).toBe('url("a\\"b\\\\c")'));
  it('заменяет только совпадающий url', () =>
    expect(replaceImageUrl('url(a.png), url(b.png)', 'b.png', 'x')).toBe('url(a.png), url("x")'));
});
