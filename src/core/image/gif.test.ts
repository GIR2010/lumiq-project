import { describe, expect, it } from 'vitest';
import { gifFrameCount } from './gif';

function gif(frames: number, withGlobalTable = true): Uint8Array {
  const out: number[] = [...'GIF89a'].map((c) => c.charCodeAt(0));
  // logical screen: 1x1, packed (global table flag, size 0 -> 2 colors)
  out.push(1, 0, 1, 0, withGlobalTable ? 0x80 : 0x00, 0, 0);
  if (withGlobalTable) out.push(0, 0, 0, 255, 255, 255);
  for (let i = 0; i < frames; i++) {
    out.push(0x21, 0xf9, 4, 0, 0, 0, 0, 0); // graphic control extension
    out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0); // image descriptor, no local table
    out.push(2, 2, 0x44, 0x01, 0); // min code size + one data sub-block + terminator
  }
  out.push(0x3b);
  return new Uint8Array(out);
}

describe('gifFrameCount', () => {
  it('1 кадр -> 1', () => expect(gifFrameCount(gif(1))).toBe(1));
  it('3 кадра -> 3', () => expect(gifFrameCount(gif(3))).toBe(3));
  it('без глобальной палитры', () => expect(gifFrameCount(gif(2, false))).toBe(2));
  it('PNG -> 1', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(gifFrameCount(png)).toBe(1);
  });
  it('пустой массив -> 1', () => expect(gifFrameCount(new Uint8Array(0))).toBe(1));
  it('обрезанный GIF не бросает и даёт >= 1', () => {
    const full = gif(3);
    for (let n = 0; n < full.length; n++) {
      expect(gifFrameCount(full.subarray(0, n))).toBeGreaterThanOrEqual(1);
    }
  });
  it('обрезанный после второго кадра -> 2', () => {
    const full = gif(3);
    expect(gifFrameCount(full.subarray(0, full.length - 1 - 15))).toBe(2);
  });
  it('локальная палитра пропускается', () => {
    const out: number[] = [...'GIF87a'].map((c) => c.charCodeAt(0));
    out.push(1, 0, 1, 0, 0x00, 0, 0);
    for (let i = 0; i < 2; i++) {
      out.push(0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x80, 0, 0, 0, 1, 1, 1);
      out.push(2, 1, 0x2c, 0);
    }
    out.push(0x3b);
    expect(gifFrameCount(new Uint8Array(out))).toBe(2);
  });
});
