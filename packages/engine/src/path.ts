import { philox4x32 } from './philox.js';

/** A decision-path segment: a manifest id or a non-negative safe integer. */
export type PathSegment = string | number;
export type Path = readonly PathSegment[];
export type Seed = string | number;

/** A 64-bit value as two uint32 words, low word first. */
export type U64 = readonly [lo: number, hi: number];

const TAG_STRING = 0x01;
const TAG_INT = 0x02;

// Philox keys that separate the two uses of the compression function (ASCII "pathhash", "seedkey!").
const PATH_DOMAIN: U64 = [0x70617468, 0x68617368];
const SEED_DOMAIN: U64 = [0x73656564, 0x6b657921];
// Initial chaining value: the first digits of pi's fractional part.
const IV: U64 = [0x243f6a88, 0x85a308d3];

const TWO_32 = 4294967296;

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function pushU32(bytes: number[], value: number): void {
  bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

/** UTF-8 encoding, written out so the engine does not depend on `TextEncoder`. */
export function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    // Lone surrogates become U+FFFD, matching TextEncoder.
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xc0 | (cp >>> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >>> 18),
        0x80 | ((cp >>> 12) & 0x3f),
        0x80 | ((cp >>> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return bytes;
}

/**
 * Canonical byte encoding of a path. Each segment is a type tag, then either a 4-byte big-endian
 * UTF-8 length plus the bytes (strings) or 8 big-endian bytes (integers).
 */
export function encodePath(path: Path): number[] {
  if (!Array.isArray(path)) throw new TypeError('Decision path must be an array');
  const bytes: number[] = [];
  for (const segment of path as PathSegment[]) {
    if (typeof segment === 'string') {
      const encoded = utf8(segment);
      bytes.push(TAG_STRING);
      pushU32(bytes, encoded.length);
      for (const b of encoded) bytes.push(b);
    } else if (isNonNegativeSafeInteger(segment)) {
      bytes.push(TAG_INT);
      pushU32(bytes, Math.floor(segment / TWO_32));
      pushU32(bytes, segment % TWO_32);
    } else {
      throw new TypeError(
        `Invalid decision path segment ${String(segment)}: expected a string or non-negative safe integer`,
      );
    }
  }
  return bytes;
}

/**
 * 64-bit hash of a byte string: Philox4x32-10 under a fixed key as the compression function,
 * chained over 8-byte blocks with a feed-forward, with 0x80 padding and a length block.
 */
function compress(bytes: readonly number[], domain: U64): U64 {
  const padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 8 !== 0) padded.push(0);
  pushU32(padded, Math.floor(bytes.length / TWO_32));
  pushU32(padded, bytes.length % TWO_32);

  let h0 = IV[0];
  let h1 = IV[1];
  for (let i = 0; i < padded.length; i += 8) {
    const m0 =
      ((padded[i]! << 24) | (padded[i + 1]! << 16) | (padded[i + 2]! << 8) | padded[i + 3]!) >>> 0;
    const m1 =
      ((padded[i + 4]! << 24) | (padded[i + 5]! << 16) | (padded[i + 6]! << 8) | padded[i + 7]!) >>>
      0;
    const out = philox4x32([h0, h1, m0, m1], domain);
    h0 = (out[0] ^ h0) >>> 0;
    h1 = (out[1] ^ h1) >>> 0;
  }
  return [h0, h1];
}

/** Hash of a decision path. Independent of the seed, so callers may cache it per path. */
export function pathHash(path: Path): U64 {
  return compress(encodePath(path), PATH_DOMAIN);
}

/**
 * Normalizes a seed to its string form. Integers become their base-10 representation, so `42` and
 * `"42"` are the same seed. Anything other than a string or a non-negative safe integer throws.
 */
export function normalizeSeed(seed: unknown): string {
  if (typeof seed === 'string') return seed;
  if (isNonNegativeSafeInteger(seed)) return String(seed);
  throw new TypeError(
    `Invalid seed ${typeof seed === 'string' ? JSON.stringify(seed) : String(seed)}: expected a string or non-negative safe integer`,
  );
}

/** The 64-bit Philox key for a seed. */
export function seedKey(seed: Seed): U64 {
  return compress(encodePath([normalizeSeed(seed)]), SEED_DOMAIN);
}
