import { SAMPLE_RATE } from './timing.js';
import type { Stem } from './wav.js';

// FLAC (RFC 9639) for stems: an exact decoder for any stream a stem may be, and (below) the
// canonical encoder that writes stems. Integer arithmetic only, so both are identical on every
// runtime. Values that may exceed 32 bits (Rice codes, LPC sums) stay in plain numbers, well below
// 2^53, and are never put through `<<`, `>>` or `|`.

/** 2^n for n in 0..53, exactly (the engine avoids `**` and Math.pow). */
const POW2: number[] = [1];
for (let i = 1; i <= 53; i++) POW2.push(POW2[i - 1]! * 2);

const CRC8 = new Uint8Array(256);
const CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c8 = i;
  for (let b = 0; b < 8; b++) c8 = c8 & 0x80 ? ((c8 << 1) ^ 0x07) & 0xff : (c8 << 1) & 0xff;
  CRC8[i] = c8;
  let c16 = i << 8;
  for (let b = 0; b < 8; b++)
    c16 = c16 & 0x8000 ? ((c16 << 1) ^ 0x8005) & 0xffff : (c16 << 1) & 0xffff;
  CRC16[i] = c16;
}

export function crc8(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) crc = CRC8[crc ^ bytes[i]!]!;
  return crc;
}

export function crc16(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) crc = ((crc << 8) & 0xffff) ^ CRC16[(crc >> 8) ^ bytes[i]!]!;
  return crc;
}

class Truncated extends Error {}

/** Reads big-endian bit fields from a byte array. `pos` is in bits. */
class BitReader {
  pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get bytePos(): number {
    return this.pos >> 3;
  }

  /** Unsigned value of the next `n` bits (0 <= n <= 53). */
  bits(n: number): number {
    const bytes = this.bytes;
    if (this.pos + n > bytes.length * 8) throw new Truncated();
    let result = 0;
    let pos = this.pos;
    while (n > 0) {
      const avail = 8 - (pos & 7);
      const take = avail < n ? avail : n;
      const v = (bytes[pos >> 3]! >> (avail - take)) & ((1 << take) - 1);
      result = result * (1 << take) + v;
      pos += take;
      n -= take;
    }
    this.pos = pos;
    return result;
  }

  /** Two's-complement signed value of the next `n` bits (1 <= n <= 33). */
  signed(n: number): number {
    const u = this.bits(n);
    return u >= POW2[n - 1]! ? u - POW2[n]! : u;
  }

  /** Counts zero bits up to and including the next one bit; returns the number of zeros. */
  unary(): number {
    const bytes = this.bytes;
    let count = 0;
    let pos = this.pos;
    for (;;) {
      const index = pos >> 3;
      if (index >= bytes.length) throw new Truncated();
      const offset = pos & 7;
      const byte = (bytes[index]! << offset) & 0xff;
      if (byte === 0) {
        count += 8 - offset;
        pos += 8 - offset;
        continue;
      }
      const lead = Math.clz32(byte) - 24;
      this.pos = pos + lead + 1;
      return count + lead;
    }
  }

  alignToByte(): void {
    this.pos = (this.pos + 7) & ~7;
  }
}

interface StreamInfo {
  minBlock: number;
  maxBlock: number;
  rate: number;
  channels: number;
  bits: number;
  total: number;
}

const RATE_CODES: (number | null)[] = [
  null,
  88200,
  176400,
  192000,
  8000,
  16000,
  22050,
  24000,
  32000,
  44100,
  48000,
  96000,
];
const DEPTH_CODES: (number | null)[] = [null, 8, 12, -1, 16, 20, 24, 32];

function blockSizeFromCode(code: number, r: BitReader): number {
  if (code === 1) return 192;
  if (code >= 2 && code <= 5) return 576 * POW2[code - 2]!;
  if (code === 6) return r.bits(8) + 1;
  if (code === 7) return r.bits(16) + 1;
  if (code >= 8) return 256 * POW2[code - 8]!;
  return -1;
}

/** Skips the UTF-8-style coded frame or sample number, checking its form. */
function skipCodedNumber(r: BitReader, fail: (what: string) => never): void {
  const first = r.bits(8);
  if (first < 0x80) return;
  let extra: number;
  if ((first & 0xe0) === 0xc0) extra = 1;
  else if ((first & 0xf0) === 0xe0) extra = 2;
  else if ((first & 0xf8) === 0xf0) extra = 3;
  else if ((first & 0xfc) === 0xf8) extra = 4;
  else if ((first & 0xfe) === 0xfc) extra = 5;
  else if (first === 0xfe) extra = 6;
  else return fail('bad frame number');
  for (let i = 0; i < extra; i++) if ((r.bits(8) & 0xc0) !== 0x80) fail('bad frame number');
}

function readResidual(
  r: BitReader,
  out: Int32Array,
  blockSize: number,
  order: number,
  fail: (what: string) => never,
): void {
  const method = r.bits(2);
  if (method > 1) fail(`reserved residual coding method ${method}`);
  const paramBits = method === 0 ? 4 : 5;
  const escape = method === 0 ? 15 : 31;
  const partitionOrder = r.bits(4);
  const partitions = 1 << partitionOrder;
  const perPartition = blockSize >> partitionOrder;
  if (perPartition * partitions !== blockSize || perPartition < order)
    fail(`bad partition order ${partitionOrder}`);
  let i = order;
  for (let p = 0; p < partitions; p++) {
    const end = (p + 1) * perPartition;
    const k = r.bits(paramBits);
    if (k === escape) {
      const n = r.bits(5);
      for (; i < end; i++) out[i] = n === 0 ? 0 : r.signed(n);
    } else {
      const scale = POW2[k]!;
      for (; i < end; i++) {
        const u = r.unary() * scale + r.bits(k);
        out[i] = u % 2 === 0 ? u / 2 : -(u + 1) / 2;
      }
    }
  }
}

/** Decodes one subframe into `out` (length >= blockSize) as integers of `bits` bits. */
function readSubframe(
  r: BitReader,
  out: Int32Array,
  blockSize: number,
  bits: number,
  fail: (what: string) => never,
): void {
  if (r.bits(1) !== 0) fail('bad subframe padding');
  const type = r.bits(6);
  let wasted = 0;
  if (r.bits(1) === 1) wasted = r.unary() + 1;
  if (wasted >= bits) fail('wasted bits exceed the sample size');
  const b = bits - wasted;

  if (type === 0) {
    const v = r.signed(b);
    out.fill(v, 0, blockSize);
  } else if (type === 1) {
    for (let i = 0; i < blockSize; i++) out[i] = r.signed(b);
  } else if (type >= 8 && type <= 12) {
    const order = type - 8;
    if (order > blockSize) fail('predictor order exceeds the block size');
    for (let i = 0; i < order; i++) out[i] = r.signed(b);
    readResidual(r, out, blockSize, order, fail);
    restoreFixed(out, blockSize, order);
  } else if (type >= 32) {
    const order = type - 31;
    if (order > blockSize) fail('predictor order exceeds the block size');
    for (let i = 0; i < order; i++) out[i] = r.signed(b);
    const precision = r.bits(4) + 1;
    if (precision === 16) fail('invalid LPC precision');
    const shift = r.signed(5);
    if (shift < 0) fail('negative LPC shift');
    const coefs: number[] = [];
    for (let i = 0; i < order; i++) coefs.push(r.signed(precision));
    readResidual(r, out, blockSize, order, fail);
    const divisor = POW2[shift]!;
    for (let i = order; i < blockSize; i++) {
      let sum = 0;
      for (let j = 0; j < order; j++) sum += coefs[j]! * out[i - 1 - j]!;
      out[i] = out[i]! + Math.floor(sum / divisor);
    }
  } else {
    fail(`reserved subframe type ${type}`);
  }

  if (wasted > 0) {
    const scale = POW2[wasted]!;
    for (let i = 0; i < blockSize; i++) out[i] = out[i]! * scale;
  }
}

/** Adds fixed-predictor predictions to residuals in place (orders 0-4). */
function restoreFixed(s: Int32Array, n: number, order: number): void {
  switch (order) {
    case 1:
      for (let i = 1; i < n; i++) s[i] = s[i]! + s[i - 1]!;
      break;
    case 2:
      for (let i = 2; i < n; i++) s[i] = s[i]! + 2 * s[i - 1]! - s[i - 2]!;
      break;
    case 3:
      for (let i = 3; i < n; i++) s[i] = s[i]! + 3 * s[i - 1]! - 3 * s[i - 2]! + s[i - 3]!;
      break;
    case 4:
      for (let i = 4; i < n; i++)
        s[i] = s[i]! + 4 * s[i - 1]! - 6 * s[i - 2]! + 4 * s[i - 3]! - s[i - 4]!;
      break;
  }
}

function readStreamInfo(r: BitReader, fail: (what: string) => never): StreamInfo {
  const minBlock = r.bits(16);
  const maxBlock = r.bits(16);
  r.bits(24); // min frame size
  r.bits(24); // max frame size
  const rate = r.bits(20);
  const channels = r.bits(3) + 1;
  const bits = r.bits(5) + 1;
  const total = r.bits(36);
  for (let i = 0; i < 4; i++) r.bits(32); // MD5: integrity is the sha256 plus the frame CRCs
  if (maxBlock === 0 || maxBlock < minBlock) fail('bad block sizes in STREAMINFO');
  return { minBlock, maxBlock, rate, channels, bits, total };
}

/**
 * Decodes a FLAC stem: 48 kHz, 1 or 2 channels, 16- or 24-bit, with a known sample count. Checks
 * every frame's CRC-8 and CRC-16 and the total sample count, and returns no audio unless all pass.
 * Samples become Float32 exactly as `decodeWav` makes them. `name` labels errors.
 */
export function decodeFlac(bytes: Uint8Array, name = 'stem'): Stem {
  const fail = (what: string): never => {
    throw new Error(`${name}: ${what}`);
  };
  try {
    return decode(bytes, fail);
  } catch (error) {
    if (error instanceof Truncated) return fail('FLAC stream is truncated');
    throw error;
  }
}

function decode(bytes: Uint8Array, fail: (what: string) => never): Stem {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x66 || // f
    bytes[1] !== 0x4c || // L
    bytes[2] !== 0x61 || // a
    bytes[3] !== 0x43 // C
  )
    fail('not a FLAC stream');
  const r = new BitReader(bytes);
  r.pos = 32;

  let info: StreamInfo | null = null;
  for (let last = false, first = true; !last; first = false) {
    last = r.bits(1) === 1;
    const type = r.bits(7);
    const length = r.bits(24);
    const body = r.bytePos;
    if (body + length > bytes.length) throw new Truncated();
    if (first !== (type === 0)) fail('STREAMINFO must be the first and only STREAMINFO block');
    if (type === 127) fail('invalid metadata block type');
    if (type === 0) {
      if (length !== 34) fail('bad STREAMINFO length');
      info = readStreamInfo(r, fail);
    }
    r.pos = (body + length) * 8;
  }
  const { rate, channels, bits, total } = info!;
  if (rate !== SAMPLE_RATE) fail(`unsupported sample rate ${rate} Hz (expected ${SAMPLE_RATE})`);
  if (channels !== 1 && channels !== 2)
    fail(`unsupported channel count ${channels} (expected 1 or 2)`);
  if (bits !== 16 && bits !== 24) fail(`unsupported bits per sample ${bits} (expected 16 or 24)`);
  if (total === 0) fail('unknown total sample count');

  const out = Array.from({ length: channels }, () => new Float32Array(total));
  const divisor = bits === 16 ? 32768 : 8388608;
  const scratch = [new Int32Array(info!.maxBlock), new Int32Array(info!.maxBlock)];
  let decoded = 0;

  while (decoded < total) {
    const frameStart = r.bytePos;
    if (r.bits(15) !== 0x7ffc) fail(`no frame sync at byte ${frameStart}`);
    r.bits(1); // blocking strategy
    const sizeCode = r.bits(4);
    const rateCode = r.bits(4);
    const assignment = r.bits(4);
    const depthCode = r.bits(3);
    if (r.bits(1) !== 0) fail('reserved frame header bit set');
    skipCodedNumber(r, fail);
    const blockSize = blockSizeFromCode(sizeCode, r);
    if (blockSize < 0) fail('reserved block size code');
    let frameRate: number | null;
    if (rateCode === 12) frameRate = r.bits(8) * 1000;
    else if (rateCode === 13) frameRate = r.bits(16);
    else if (rateCode === 14) frameRate = r.bits(16) * 10;
    else if (rateCode === 15) return fail('invalid sample rate code');
    else frameRate = RATE_CODES[rateCode]!;
    const headerEnd = r.bytePos;
    if (r.bits(8) !== crc8(bytes, frameStart, headerEnd))
      fail(`frame header CRC mismatch at byte ${frameStart}`);

    if (frameRate !== null && frameRate !== rate) fail('frame sample rate differs from STREAMINFO');
    const depth = DEPTH_CODES[depthCode]!;
    if (depth === -1) fail('reserved sample size code');
    if (depth !== null && depth !== bits) fail('frame sample size differs from STREAMINFO');
    if (assignment > 10) fail(`reserved channel assignment ${assignment}`);
    const frameChannels = assignment < 8 ? assignment + 1 : 2;
    if (frameChannels !== channels) fail('frame channel count differs from STREAMINFO');
    if (blockSize > scratch[0]!.length) fail('block larger than STREAMINFO maximum');
    if (decoded + blockSize > total) fail('frames hold more samples than STREAMINFO');

    const a = scratch[0]!;
    const b = scratch[1]!;
    if (channels === 1) {
      readSubframe(r, a, blockSize, bits, fail);
    } else {
      readSubframe(r, a, blockSize, bits + (assignment === 9 ? 1 : 0), fail);
      readSubframe(r, b, blockSize, bits + (assignment === 8 || assignment === 10 ? 1 : 0), fail);
      if (assignment === 8) {
        for (let i = 0; i < blockSize; i++) b[i] = a[i]! - b[i]!;
      } else if (assignment === 9) {
        for (let i = 0; i < blockSize; i++) a[i] = a[i]! + b[i]!;
      } else if (assignment === 10) {
        for (let i = 0; i < blockSize; i++) {
          const side = b[i]!;
          const mid = a[i]! * 2 + (side & 1);
          a[i] = (mid + side) >> 1;
          b[i] = (mid - side) >> 1;
        }
      }
    }
    r.alignToByte();
    const crcEnd = r.bytePos;
    if (r.bits(16) !== crc16(bytes, frameStart, crcEnd))
      fail(`frame CRC mismatch at byte ${frameStart}`);

    for (let c = 0; c < channels; c++) {
      const src = scratch[c]!;
      const dst = out[c]!;
      for (let i = 0; i < blockSize; i++) dst[decoded + i] = src[i]! / divisor;
    }
    decoded += blockSize;
  }
  if (r.bytePos !== bytes.length) fail('data after the last frame');
  return { channels: out, frames: total };
}

// ---------------------------------------------------------------------------------------------
// The canonical encoder. Every choice below is a fixed rule with a fixed tie-break (design D2), so
// the same samples always produce the same bytes. Changing any rule changes every stem's hash.

const BLOCK_SIZE = 4096;
const MAX_PARTITION_ORDER = 8;
const MAX_RICE_PARAM = 30;

/** Big-endian bit writer into a growable byte buffer. */
class BitWriter {
  bytes = new Uint8Array(1 << 16);
  length = 0; // whole bytes written
  private cur = 0;
  private nbits = 0;

  private push(byte: number): void {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = byte;
  }

  /** Writes the low `n` bits of `v` (0 <= n <= 32, 0 <= v < 2^32). */
  bits(v: number, n: number): void {
    while (n > 0) {
      const space = 8 - this.nbits;
      const take = space < n ? space : n;
      const chunk = (v >>> (n - take)) & ((1 << take) - 1);
      this.cur = (this.cur << take) | chunk;
      this.nbits += take;
      n -= take;
      if (this.nbits === 8) {
        this.push(this.cur);
        this.cur = 0;
        this.nbits = 0;
      }
    }
  }

  signed(v: number, n: number): void {
    this.bits(v < 0 ? v + POW2[n]! : v, n);
  }

  /** `q` zero bits, then a one. */
  unary(q: number): void {
    while (q > 0) {
      const space = 8 - this.nbits;
      const take = space < q ? space : q;
      this.cur = this.cur << take;
      this.nbits += take;
      q -= take;
      if (this.nbits === 8) {
        this.push(this.cur & 0xff);
        this.cur = 0;
        this.nbits = 0;
      }
    }
    this.bits(1, 1);
  }

  /** Pads with zero bits to a byte boundary. */
  align(): void {
    if (this.nbits > 0) this.bits(0, 8 - this.nbits);
  }

  out(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

/** How one subframe is coded. `bits` is the coded size in bits, header included. */
interface SubframePlan {
  kind: 'constant' | 'fixed' | 'verbatim';
  order: number;
  wasted: number;
  partitionOrder: number;
  params: number[];
  bits: number;
}

/** Fixed-predictor residuals of order 0-4 for samples[0..n), written to res[order..n). */
function fixedResidual(s: Int32Array, n: number, order: number, res: Int32Array): void {
  switch (order) {
    case 0:
      for (let i = 0; i < n; i++) res[i] = s[i]!;
      break;
    case 1:
      for (let i = 1; i < n; i++) res[i] = s[i]! - s[i - 1]!;
      break;
    case 2:
      for (let i = 2; i < n; i++) res[i] = s[i]! - 2 * s[i - 1]! + s[i - 2]!;
      break;
    case 3:
      for (let i = 3; i < n; i++) res[i] = s[i]! - 3 * s[i - 1]! + 3 * s[i - 2]! - s[i - 3]!;
      break;
    case 4:
      for (let i = 4; i < n; i++)
        res[i] = s[i]! - 4 * s[i - 1]! + 6 * s[i - 2]! - 4 * s[i - 3]! + s[i - 4]!;
      break;
  }
}

const zigzag = (r: number): number => (r >= 0 ? r * 2 : -r * 2 - 1);

/**
 * The cheapest Rice coding of res[order..n): partition orders 0-8 where the block divides evenly
 * and every partition holds more samples than `order`; per partition the cheapest parameter in
 * 0-30 (ties to the lower); then the cheapest partition order (ties to the lower). The parameter
 * field is 4 bits per partition when every parameter is at most 14, and 5 bits otherwise.
 */
function planResidual(
  res: Int32Array,
  n: number,
  order: number,
  sums: Float64Array,
): { partitionOrder: number; params: number[]; bits: number } {
  let finest = 0;
  while (finest < MAX_PARTITION_ORDER && n % (1 << (finest + 1)) === 0 && n >> (finest + 1) > order)
    finest++;
  const parts = 1 << finest;
  const per = n >> finest;
  const width = MAX_RICE_PARAM + 1;
  // sums[p * width + k] = sum over partition p (at the finest order) of floor(u / 2^k).
  sums.fill(0, 0, parts * width);
  for (let p = 0; p < parts; p++) {
    const base = p * width;
    for (let i = p === 0 ? order : p * per, end = (p + 1) * per; i < end; i++) {
      let u = zigzag(res[i]!);
      for (let k = 0; u > 0; k++, u >>>= 1) sums[base + k]! += u;
    }
  }

  let best: { partitionOrder: number; params: number[]; bits: number } | null = null;
  for (let level = finest; level >= 0; level--) {
    const count = 1 << level;
    const group = 1 << (finest - level); // finest partitions per partition at this level
    const params: number[] = [];
    let bits = 0;
    for (let p = 0; p < count; p++) {
      const samples = (n >> level) - (p === 0 ? order : 0);
      let bestK = 0;
      let bestCost = Infinity;
      for (let k = 0; k <= MAX_RICE_PARAM; k++) {
        let s = 0;
        for (let g = p * group; g < (p + 1) * group; g++) s += sums[g * width + k]!;
        const cost = s + samples * (k + 1);
        if (cost < bestCost) {
          bestCost = cost;
          bestK = k;
        }
      }
      params.push(bestK);
      bits += bestCost;
    }
    const paramBits = params.every((k) => k <= 14) ? 4 : 5;
    bits += 2 + 4 + count * paramBits;
    // Iterating from the finest order down, `<=` makes ties go to the lower partition order.
    if (best === null || bits <= best.bits) best = { partitionOrder: level, params, bits };
  }
  return best!;
}

/** Scratch buffers reused across blocks. */
interface Scratch {
  shifted: Int32Array;
  res: Int32Array;
  sums: Float64Array;
}

function makeScratch(): Scratch {
  return {
    shifted: new Int32Array(BLOCK_SIZE),
    res: new Int32Array(BLOCK_SIZE),
    sums: new Float64Array((1 << MAX_PARTITION_ORDER) * (MAX_RICE_PARAM + 1)),
  };
}

/** Shared trailing zero bits of every sample (0 when all are zero). */
function wastedBits(s: Int32Array, n: number): number {
  let or = 0;
  for (let i = 0; i < n; i++) or |= s[i]!;
  if (or === 0) return 0;
  let w = 0;
  while ((or & 1) === 0) {
    or >>= 1;
    w++;
  }
  return w;
}

/** The cheapest subframe for s[0..n) at `bps` bits. Ties: constant, fixed by order, verbatim. */
function planSubframe(s: Int32Array, n: number, bps: number, scratch: Scratch): SubframePlan {
  let constant = true;
  for (let i = 1; i < n && constant; i++) if (s[i] !== s[0]) constant = false;
  if (constant)
    return { kind: 'constant', order: 0, wasted: 0, partitionOrder: 0, params: [], bits: 8 + bps };

  const wasted = wastedBits(s, n);
  const b = bps - wasted;
  const header = 8 + wasted;
  const src = wasted > 0 ? scratch.shifted : s;
  if (wasted > 0) for (let i = 0; i < n; i++) scratch.shifted[i] = s[i]! >> wasted;

  let best: SubframePlan | null = null;
  for (let order = 0; order <= 4 && order < n; order++) {
    fixedResidual(src, n, order, scratch.res);
    const r = planResidual(scratch.res, n, order, scratch.sums);
    const bits = header + order * b + r.bits;
    if (best === null || bits < best.bits)
      best = {
        kind: 'fixed',
        order,
        wasted,
        partitionOrder: r.partitionOrder,
        params: r.params,
        bits,
      };
  }
  const verbatim = header + n * b;
  if (verbatim < best!.bits)
    return { kind: 'verbatim', order: 0, wasted, partitionOrder: 0, params: [], bits: verbatim };
  return best!;
}

function writeSubframe(
  w: BitWriter,
  s: Int32Array,
  n: number,
  bps: number,
  plan: SubframePlan,
  scratch: Scratch,
): void {
  w.bits(0, 1);
  if (plan.kind === 'constant') {
    w.bits(0, 6);
    w.bits(0, 1);
    w.signed(s[0]!, bps);
    return;
  }
  w.bits(plan.kind === 'verbatim' ? 1 : 8 + plan.order, 6);
  if (plan.wasted > 0) {
    w.bits(1, 1);
    w.unary(plan.wasted - 1);
  } else {
    w.bits(0, 1);
  }
  const b = bps - plan.wasted;
  const src = plan.wasted > 0 ? scratch.shifted : s;
  if (plan.wasted > 0) for (let i = 0; i < n; i++) scratch.shifted[i] = s[i]! >> plan.wasted;
  if (plan.kind === 'verbatim') {
    for (let i = 0; i < n; i++) w.signed(src[i]!, b);
    return;
  }
  const { order, partitionOrder, params } = plan;
  for (let i = 0; i < order; i++) w.signed(src[i]!, b);
  fixedResidual(src, n, order, scratch.res);
  const rice2 = !params.every((k) => k <= 14);
  w.bits(rice2 ? 1 : 0, 2);
  w.bits(partitionOrder, 4);
  const per = n >> partitionOrder;
  for (let p = 0; p < params.length; p++) {
    const k = params[p]!;
    w.bits(k, rice2 ? 5 : 4);
    const mask = k === 0 ? 0 : 0xffffffff >>> (32 - k);
    for (let i = p === 0 ? order : p * per, end = (p + 1) * per; i < end; i++) {
      const u = zigzag(scratch.res[i]!);
      w.unary(u >>> k);
      if (k > 0) w.bits(u & mask, k);
    }
  }
}

/** A subframe to write: its samples, their depth and how they are coded. */
interface Coded {
  samples: Int32Array;
  bps: number;
  plan: SubframePlan;
}

/** The UTF-8-style coding of a frame number. */
function writeCodedNumber(w: BitWriter, v: number): void {
  if (v < 0x80) return w.bits(v, 8);
  let extra: number;
  let lead: number;
  if (v < 0x800) [extra, lead] = [1, 0xc0];
  else if (v < 0x10000) [extra, lead] = [2, 0xe0];
  else if (v < 0x200000) [extra, lead] = [3, 0xf0];
  else if (v < 0x4000000) [extra, lead] = [4, 0xf8];
  else [extra, lead] = [5, 0xfc];
  w.bits(lead | (v >>> (6 * extra)), 8);
  for (let i = extra - 1; i >= 0; i--) w.bits(0x80 | ((v >>> (6 * i)) & 0x3f), 8);
}

/**
 * Encodes 1 or 2 equal-length channels of 16- or 24-bit integer samples at 48 kHz as a canonical
 * FLAC stream (design D2): one STREAMINFO block with an all-zero MD5, 4,096-sample blocks, fixed
 * predictors, and fixed rules with fixed tie-breaks for every choice. Integer arithmetic only.
 */
export function encodeFlac(channels: readonly Int32Array[], bits: 16 | 24): Uint8Array {
  const count = channels.length;
  if (count !== 1 && count !== 2) throw new RangeError('encodeFlac needs 1 or 2 channels');
  if (bits !== 16 && bits !== 24) throw new RangeError('encodeFlac needs 16 or 24 bits');
  const total = channels[0]!.length;
  if (channels.some((c) => c.length !== total)) throw new RangeError('channel lengths differ');
  if (total === 0) throw new RangeError('encodeFlac needs at least one sample');
  if (total >= POW2[36]!) throw new RangeError('too many samples');
  const min = -POW2[bits - 1]!;
  const max = POW2[bits - 1]! - 1;
  for (const c of channels)
    for (let i = 0; i < total; i++)
      if (c[i]! < min || c[i]! > max) throw new RangeError(`sample ${c[i]} exceeds ${bits} bits`);

  const w = new BitWriter();
  w.bits(0x664c6143, 32); // fLaC
  w.bits(1, 1); // last metadata block
  w.bits(0, 7); // STREAMINFO
  w.bits(34, 24);
  w.bits(BLOCK_SIZE, 16);
  w.bits(BLOCK_SIZE, 16);
  w.bits(0, 24); // min frame size: unknown
  w.bits(0, 24); // max frame size: unknown
  w.bits(SAMPLE_RATE, 20);
  w.bits(count - 1, 3);
  w.bits(bits - 1, 5);
  w.bits(Math.floor(total / POW2[32]!), 4);
  w.bits(total % POW2[32]!, 32);
  for (let i = 0; i < 4; i++) w.bits(0, 32); // MD5: not computed

  const scratch = makeScratch();
  const side = new Int32Array(BLOCK_SIZE);
  const mid = new Int32Array(BLOCK_SIZE);
  for (let start = 0, frame = 0; start < total; start += BLOCK_SIZE, frame++) {
    const n = Math.min(BLOCK_SIZE, total - start);
    const blockChannels = channels.map((c) => c.subarray(start, start + n));

    // Channel assignment and the subframes to write, each with its sample depth.
    let assignment: number;
    let subframes: Coded[];
    if (count === 1) {
      const s = blockChannels[0]!;
      assignment = 0;
      subframes = [{ samples: s, bps: bits, plan: planSubframe(s, n, bits, scratch) }];
    } else {
      const l = blockChannels[0]!;
      const r = blockChannels[1]!;
      for (let i = 0; i < n; i++) {
        side[i] = l[i]! - r[i]!;
        mid[i] = (l[i]! + r[i]!) >> 1;
      }
      const S = side.subarray(0, n);
      const M = mid.subarray(0, n);
      const L: Coded = { samples: l, bps: bits, plan: planSubframe(l, n, bits, scratch) };
      const R: Coded = { samples: r, bps: bits, plan: planSubframe(r, n, bits, scratch) };
      const Sd: Coded = { samples: S, bps: bits + 1, plan: planSubframe(S, n, bits + 1, scratch) };
      const Md: Coded = { samples: M, bps: bits, plan: planSubframe(M, n, bits, scratch) };
      // Independent, left/side, side/right, mid/side: the cheapest, ties in that order.
      const options: [number, Coded[]][] = [
        [1, [L, R]],
        [8, [L, Sd]],
        [9, [Sd, R]],
        [10, [Md, Sd]],
      ];
      let bestIndex = 0;
      let bestBits = Infinity;
      options.forEach(([, subs], i) => {
        const total = subs[0]!.plan.bits + subs[1]!.plan.bits;
        if (total < bestBits) {
          bestBits = total;
          bestIndex = i;
        }
      });
      [assignment, subframes] = options[bestIndex]!;
    }

    const frameStart = w.length;
    w.bits(0x3ffe, 14); // sync
    w.bits(0, 1); // reserved
    w.bits(0, 1); // fixed block size
    w.bits(n === BLOCK_SIZE ? 12 : 7, 4); // 4,096, or a 16-bit size at the end of the header
    w.bits(10, 4); // 48 kHz
    w.bits(assignment, 4);
    w.bits(bits === 16 ? 4 : 6, 3);
    w.bits(0, 1); // reserved
    writeCodedNumber(w, frame);
    if (n !== BLOCK_SIZE) w.bits(n - 1, 16);
    w.bits(crc8(w.bytes, frameStart, w.length), 8);
    for (const sub of subframes) writeSubframe(w, sub.samples, n, sub.bps, sub.plan, scratch);
    w.align();
    w.bits(crc16(w.bytes, frameStart, w.length), 16);
  }
  return w.out();
}
