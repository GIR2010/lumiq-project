/** CSS properties whose value may carry a single swappable image url(). */
export const IMAGE_PROPS: ReadonlyArray<string> = [
  'background-image',
  'background',
  'list-style-image',
  'list-style',
  'content',
];

const BS = String.fromCharCode(92);

interface UrlToken {
  start: number; // index of "u" in url(
  end: number; // index just past the closing ")"
  arg: string; // decoded argument
}

interface Scan {
  urls: UrlToken[]; // top-level url() tokens
  nestedUrls: number; // url() tokens inside other functions
  unsupported: boolean; // gradient / image-set / top-level comma / malformed
}

const isIdentChar = (c: string): boolean =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-' || c === '_';
const isHex = (c: string): boolean =>
  (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/** Reads a CSS escape starting after the backslash at `i`; returns [text, nextIndex]. */
function readEscape(s: string, i: number): [string, number] {
  if (i >= s.length) return ['', i];
  if (isHex(s[i])) {
    let j = i;
    while (j < s.length && j - i < 6 && isHex(s[j])) j++;
    const cp = parseInt(s.slice(i, j), 16);
    if (j < s.length && isSpace(s[j])) j++;
    const ok = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
    return [ok ? String.fromCodePoint(cp) : '�', j];
  }
  return [s[i], i + 1];
}

/** Parses the url( argument at `i` (just after "("); returns null when malformed. */
function readUrlArg(s: string, i: number): { arg: string; end: number } | null {
  while (i < s.length && isSpace(s[i])) i++;
  let arg = '';
  if (s[i] === '"' || s[i] === "'") {
    const q = s[i++];
    for (;;) {
      if (i >= s.length) return null;
      const c = s[i];
      if (c === q) { i++; break; }
      if (c === BS) {
        if (s[i + 1] === '\n') { i += 2; continue; }
        const [t, next] = readEscape(s, i + 1);
        arg += t;
        i = next;
      } else {
        arg += c;
        i++;
      }
    }
    while (i < s.length && isSpace(s[i])) i++;
    if (s[i] !== ')') return null;
    return { arg, end: i + 1 };
  }
  for (;;) {
    if (i >= s.length) return null;
    const c = s[i];
    if (c === ')') { i++; break; }
    if (isSpace(c)) {
      while (i < s.length && isSpace(s[i])) i++;
      if (s[i] !== ')') return null;
      i++;
      break;
    }
    if (c === '"' || c === "'" || c === '(') return null;
    if (c === BS) {
      const [t, next] = readEscape(s, i + 1);
      arg += t;
      i = next;
    } else {
      arg += c;
      i++;
    }
  }
  return { arg, end: i };
}

function scan(value: string): Scan {
  const res: Scan = { urls: [], nestedUrls: 0, unsupported: false };
  let depth = 0;
  let i = 0;
  while (i < value.length) {
    const c = value[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < value.length && value[i] !== c) i += value[i] === BS ? 2 : 1;
      i++;
    } else if (c === BS) {
      i += 2;
    } else if (c === ',' && depth === 0) {
      res.unsupported = true;
      i++;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
      i++;
    } else if (c === '(') {
      let s = i;
      while (s > 0 && isIdentChar(value[s - 1])) s--;
      const name = value.slice(s, i).toLowerCase();
      if (name === 'url') {
        const parsed = readUrlArg(value, i + 1);
        if (!parsed) {
          res.unsupported = true;
          return res;
        }
        if (depth === 0) res.urls.push({ start: s, end: parsed.end, arg: parsed.arg });
        else res.nestedUrls++;
        i = parsed.end;
      } else {
        if (name.endsWith('-gradient') || name.endsWith('image-set') || name === 'image') {
          res.unsupported = true;
        }
        depth++;
        i++;
      }
    } else {
      i++;
    }
  }
  return res;
}

/**
 * Returns the raw (unescaped, not resolved) URL when `value` of `prop` contains
 * exactly one url() and no gradients, image-set() or multiple layers; else null.
 */
export function singleImageUrl(prop: string, value: string): string | null {
  if (!IMAGE_PROPS.includes(prop)) return null;
  const r = scan(value);
  if (r.unsupported || r.nestedUrls > 0 || r.urls.length !== 1) return null;
  const u = r.urls[0];
  if (prop === 'content' && value.slice(0, u.start).trim() + value.slice(u.end).trim() !== '') {
    return null;
  }
  return u.arg;
}

/** Replaces every top-level url() whose decoded argument equals `from` with url("to"). */
export function replaceImageUrl(value: string, from: string, to: string): string {
  const r = scan(value);
  const quoted = `url("${to.replace(/[\\"]/g, '\\$&')}")`;
  let out = '';
  let last = 0;
  for (const u of r.urls) {
    if (u.arg !== from) continue;
    out += value.slice(last, u.start) + quoted;
    last = u.end;
  }
  return out + value.slice(last);
}

/**
 * Rewrites every url() of a stylesheet text to an absolute, quoted URL resolved against `base`, so the
 * text can be parsed (or concatenated with other files) without its own location. Comments and strings
 * are skipped; fragment-only (`url(#id)`), `data:` and unresolvable or malformed url()s are kept as is.
 */
export function absolutizeUrls(css: string, base: string): string {
  let out = '';
  let last = 0;
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2);
      i = e < 0 ? css.length : e + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < css.length && css[i] !== c && css[i] !== '\n') i += css[i] === BS ? 2 : 1;
      i++;
    } else if (c === BS) {
      i += 2;
    } else if ((c === 'u' || c === 'U') && css.slice(i, i + 4).toLowerCase() === 'url(' && !(i > 0 && isIdentChar(css[i - 1]))) {
      const parsed = readUrlArg(css, i + 4);
      if (!parsed) { i += 4; continue; }
      const arg = parsed.arg.trim();
      if (arg && !arg.startsWith('#') && !/^data:/i.test(arg)) {
        try {
          const abs = new URL(arg, base).href;
          out += `${css.slice(last, i)}url("${abs.replace(/[\\"]/g, '\$&')}")`;
          last = parsed.end;
        } catch { /* unresolvable: keep */ }
      }
      i = parsed.end;
    } else {
      i++;
    }
  }
  return out + css.slice(last);
}
