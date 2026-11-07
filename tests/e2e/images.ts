import { deflateSync } from 'node:zlib';

/**
 * Fixture images generated in code (no binaries in the repo): tiny PNG and GIF encoders plus the
 * icon-test images served by the e2e server.
 */

type Rgba = [number, number, number, number];
type Painter = (x: number, y: number) => Rgba;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** RGBA, 8 bits per channel, no filtering. */
export function png(width: number, height: number, paint: Painter): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x++) raw.set(paint(x, y), row + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

const LZW_MIN = 8;
const CLEAR = 1 << LZW_MIN;
/** Pixels between clear codes: the decoder's table never grows past 9-bit codes. */
const CLEAR_EVERY = 200;

/** LZW without compression: every pixel is its own 9-bit code, with a clear code every few pixels. */
function lzw(indices: number[]): Buffer {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  const put = (code: number) => {
    acc |= code << bits;
    bits += LZW_MIN + 1;
    while (bits >= 8) { bytes.push(acc & 0xff); acc >>>= 8; bits -= 8; }
  };
  indices.forEach((ix, i) => {
    if (i % CLEAR_EVERY === 0) put(CLEAR);
    put(ix);
  });
  put(CLEAR + 1);
  if (bits > 0) bytes.push(acc & 0xff);
  const out: number[] = [LZW_MIN];
  for (let i = 0; i < bytes.length; i += 255) {
    const block = bytes.slice(i, i + 255);
    out.push(block.length, ...block);
  }
  out.push(0);
  return Buffer.from(out);
}

/**
 * GIF89a with a 256-entry palette; index 0 is transparent. Each frame is a function giving the palette
 * index of a pixel. More than one frame makes an animated GIF (looping, 200 ms per frame).
 */
export function gif(width: number, height: number, palette: [number, number, number][], frames: ((x: number, y: number) => number)[]): Buffer {
  const le = (n: number) => [n & 0xff, n >> 8];
  const parts: Buffer[] = [Buffer.from('GIF89a', 'ascii')];
  parts.push(Buffer.from([...le(width), ...le(height), 0xf7, 0, 0]));
  const table = Buffer.alloc(256 * 3);
  palette.forEach((c, i) => table.set(c, i * 3));
  parts.push(table);
  if (frames.length > 1) parts.push(Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0', 'ascii'), 3, 1, 0, 0, 0]));
  for (const frame of frames) {
    // Graphic control: dispose to background, transparent index 0, 200 ms delay.
    parts.push(Buffer.from([0x21, 0xf9, 4, 0x09, ...le(20), 0, 0]));
    parts.push(Buffer.from([0x2c, 0, 0, 0, 0, ...le(width), ...le(height), 0]));
    const indices: number[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) indices.push(frame(x, y));
    parts.push(lzw(indices));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

const CLEAR_PX: Rgba = [0, 0, 0, 0];
const DARK: Rgba = [0x22, 0x22, 0x22, 255];

/** A 16×16 glyph: plus (0), ring (1) or square outline (2). */
function glyph(kind: number, x: number, y: number): boolean {
  if (kind === 0) return (x >= 6 && x < 10 && y >= 2 && y < 14) || (y >= 6 && y < 10 && x >= 2 && x < 14);
  if (kind === 1) { const d = Math.hypot(x - 7.5, y - 7.5); return d >= 4 && d <= 7; }
  return x >= 2 && x < 14 && y >= 2 && y < 14 && !(x >= 5 && x < 11 && y >= 5 && y < 11);
}

/** Right-pointing triangle in a 12×12 box. */
const arrow = (x: number, y: number) => x >= 3 && x < 10 && Math.abs(y - 5.5) <= (x - 3) * 0.8;

/** URL path → [content type, body] for the icon fixture page. */
export function iconImages(): Record<string, [string, Buffer]> {
  return {
    // Sprite of three dark glyphs on transparency.
    '/dark-glyph.png': ['image/png', png(48, 16, (x, y) => (glyph(Math.floor(x / 16), x % 16, y) ? DARK : CLEAR_PX))],
    // A single-frame transparent GIF arrow (list marker).
    '/dark-arrow.gif': ['image/gif', gif(12, 12, [[0, 0, 0], [0x22, 0x22, 0x22]], [(x, y) => (arrow(x, y) ? 1 : 0)])],
    // The same kind of dark glyph, but animated: must not be swapped in CSS.
    '/anim.gif': ['image/gif', gif(16, 16, [[0, 0, 0], [0x22, 0x22, 0x22]], [
      (x, y) => (glyph(0, x, y) ? 1 : 0),
      (x, y) => (glyph(1, x, y) ? 1 : 0),
    ])],
    // Light coloured "logo" on transparency: bars of light blue and light orange.
    '/color-logo.png': ['image/png', png(120, 18, (x, y) => {
      if (y < 3 || y >= 15 || x % 10 >= 7) return CLEAR_PX;
      return x < 60 ? [0x8f, 0xcf, 0xff, 255] : [0xff, 0xd0, 0x80, 255];
    })],
    // An opaque dark "photo": only the transparency rule keeps it from being an icon.
    '/photo.png': ['image/png', png(64, 48, (x, y) => [20 + x, 30 + y, 60, 255])],
    // Dark text, with explicit size.
    '/dark-text.svg': ['image/svg+xml', Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="18" viewBox="0 0 120 18">'
      + '<text x="2" y="15" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#123">Dark text</text></svg>')],
    // No width/height, default currentColor (black) fill.
    '/icon-nosize.svg': ['image/svg+xml', Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
      + '<path fill="currentColor" d="M3 3h18v4H3zM3 10h12v4H3zM3 17h18v4H3z"/></svg>')],
  };
}
