/**
 * Counts frames of a GIF by walking its block structure.
 * Returns 1 for non-GIF or corrupted input; never throws.
 */
export function gifFrameCount(bytes: Uint8Array): number {
  const n = bytes.length;
  if (n < 13) return 1;
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return 1;

  let pos = 13;
  const screenPacked = bytes[10];
  if (screenPacked & 0x80) pos += 3 * (1 << ((screenPacked & 7) + 1));

  // Skips data sub-blocks up to and including the 0 terminator; -1 if truncated.
  const skipSubBlocks = (p: number): number => {
    while (p < n) {
      const size = bytes[p];
      p += 1 + size;
      if (size === 0) return p;
    }
    return -1;
  };

  let frames = 0;
  while (pos < n) {
    const b = bytes[pos];
    if (b === 0x3b) break;
    if (b === 0x21) {
      pos = skipSubBlocks(pos + 2);
    } else if (b === 0x2c) {
      if (pos + 10 > n) {
        frames++; // descriptor present but cut off
        break;
      }
      frames++;
      const packed = bytes[pos + 9];
      pos += 10;
      if (packed & 0x80) pos += 3 * (1 << ((packed & 7) + 1));
      pos = skipSubBlocks(pos + 1);
    } else {
      break; // unknown block: corrupted
    }
    if (pos < 0) break;
  }
  return Math.max(1, frames);
}
