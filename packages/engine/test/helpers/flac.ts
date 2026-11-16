import { createRandom } from '../../src/random.js';

// An independent, deliberately simple FLAC writer for tests: VERBATIM subframes, independent
// channels, any rate and depth. It shares no code with the engine's codec.

class Bits {
  private bytes: number[] = [];
  private acc = 0;
  private n = 0;
  write(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | (Math.floor(value / 2 ** i) & 1);
      if (++this.n === 8) {
        this.bytes.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  signed(value: number, width: number): void {
    this.write(value < 0 ? value + 2 ** width : value, width);
  }
  align(): void {
    while (this.n !== 0) this.write(0, 1);
  }
  get length(): number {
    return this.bytes.length;
  }
  out(): number[] {
    return this.bytes;
  }
}

function crc(bytes: number[], poly: number, width: number): number {
  const top = 1 << (width - 1);
  const mask = (1 << width) - 1;
  let c = 0;
  for (const byte of bytes) {
    c ^= byte << (width - 8);
    for (let i = 0; i < 8; i++) c = c & top ? ((c << 1) ^ poly) & mask : (c << 1) & mask;
  }
  return c;
}

const RATE_CODE: Record<number, number> = { 44100: 9, 48000: 10, 96000: 11 };
const DEPTH_CODE: Record<number, number> = { 8: 1, 12: 2, 16: 4, 20: 5, 24: 6, 32: 7 };

export interface TestFlacOptions {
  rate?: number;
  bits: number;
  /** channels[c][i] as raw integers. */
  channels: number[][];
  blockSize?: number;
  /** Overrides STREAMINFO's total sample count. */
  total?: number;
}

/** Writes a valid FLAC stream (VERBATIM subframes) for the given integer samples. */
export function makeFlac(opts: TestFlacOptions): Uint8Array {
  const rate = opts.rate ?? 48000;
  const { bits, channels } = opts;
  const frames = channels[0]!.length;
  const blockSize = opts.blockSize ?? 1024;
  const head = new Bits();
  for (const ch of 'fLaC') head.write(ch.charCodeAt(0), 8);
  head.write(1, 1); // last metadata block
  head.write(0, 7); // STREAMINFO
  head.write(34, 24);
  head.write(blockSize, 16);
  head.write(blockSize, 16);
  head.write(0, 24);
  head.write(0, 24);
  head.write(rate, 20);
  head.write(channels.length - 1, 3);
  head.write(bits - 1, 5);
  head.write(opts.total ?? frames, 36);
  for (let i = 0; i < 16; i++) head.write(0, 8);
  const out = [...head.out()];

  for (let start = 0, number = 0; start < frames; start += blockSize, number++) {
    const n = Math.min(blockSize, frames - start);
    const f = new Bits();
    f.write(0x3ffe, 14);
    f.write(0, 1);
    f.write(0, 1); // fixed block size
    f.write(7, 4); // 16-bit block size follows
    f.write(RATE_CODE[rate] ?? 0, 4);
    f.write(channels.length - 1, 4);
    f.write(DEPTH_CODE[bits] ?? 0, 3);
    f.write(0, 1);
    if (number >= 128) throw new Error('test writer handles up to 128 frames');
    f.write(number, 8);
    f.write(n - 1, 16);
    f.write(crc(f.out(), 0x07, 8), 8);
    for (const ch of channels) {
      f.write(0, 1);
      f.write(1, 6); // VERBATIM
      f.write(0, 1);
      for (let i = 0; i < n; i++) f.signed(ch[start + i]!, bits);
    }
    f.align();
    const body = f.out();
    const c = crc(body, 0x8005, 16);
    out.push(...body, c >> 8, c & 0xff);
  }
  return new Uint8Array(out);
}

/** Committed synthetic test signals: integer samples from fixed formulas and the engine's PRNG. */
export function testSignal(
  kind: 'silence' | 'extremes' | 'noise' | 'sine',
  bits: 16 | 24,
  frames: number,
  channel = 0,
): Int32Array {
  const max = bits === 16 ? 32767 : 8388607;
  const min = -max - 1;
  const out = new Int32Array(frames);
  if (kind === 'extremes') for (let i = 0; i < frames; i++) out[i] = (i + channel) % 2 ? max : min;
  if (kind === 'noise') {
    const rng = createRandom(`noise-${bits}-${channel}`);
    const span = max - min + 1;
    for (let i = 0; i < frames; i++) out[i] = min + (rng.draw(['noise'], i) % span);
  }
  if (kind === 'sine') {
    // A sine from a fixed integer recurrence (no Math.sin), so the signal is the same everywhere.
    let x = Math.trunc(max * 0.7);
    let y = 0;
    for (let i = 0; i < frames; i++) {
      out[i] = channel === 0 ? x : Math.trunc(x * 0.9) - (i % 3);
      const nx = x - Math.trunc(y / 64);
      y = y + Math.trunc(nx / 64);
      x = nx;
    }
  }
  return out;
}
