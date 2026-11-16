import { decodeFlac } from '@spite-store/engine';
import { describe, expect, it } from 'vitest';
import { readFrames, readWavLayout, sliceStem } from '../src/wavslice.js';
import { buildWav, noiseBytes } from './wav-fixtures.js';

const meta = (n: number): Uint8Array => new Uint8Array(n).fill(0x42);

/** Little-endian signed integers from raw sample bytes. */
function ints(bytes: Uint8Array, bps: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < bytes.length; p += bps) {
    let v = 0;
    for (let i = bps - 1; i >= 0; i--) v = v * 256 + bytes[p + i]!;
    out.push(v >= 2 ** (8 * bps - 1) ? v - 2 ** (8 * bps) : v);
  }
  return out;
}

describe('readWavLayout and sliceStem', () => {
  it('keeps the source samples for the range exactly (24-bit mono)', () => {
    const samples = noiseBytes(1000, 3);
    const src = buildWav({ samples });
    const out = sliceStem(src, readWavLayout(src), 100, 351);
    expect(String.fromCharCode(...out.subarray(0, 4))).toBe('fLaC');
    const stem = decodeFlac(out);
    expect(stem.frames).toBe(251);
    expect(stem.channels.length).toBe(1);
    const want = ints(samples.subarray(300, 1053), 3);
    expect(Array.from(stem.channels[0]!, (v) => v * 8388608)).toEqual(want);
  });

  it('reads 16-bit stereo frames', () => {
    const samples = noiseBytes(64, 4, 5);
    const src = buildWav({ samples, bits: 16, channels: 2 });
    const [l, r] = readFrames(src, readWavLayout(src), 0, 64);
    const all = ints(samples, 2);
    expect(Array.from(l!)).toEqual(all.filter((_, i) => i % 2 === 0));
    expect(Array.from(r!)).toEqual(all.filter((_, i) => i % 2 === 1));
  });

  it('ignores metadata chunks and the extensible header', () => {
    const samples = noiseBytes(500, 6, 7);
    const plain = buildWav({ samples, channels: 2 });
    const tagged = buildWav({
      samples,
      channels: 2,
      extensible: true,
      before: [
        ['JUNK', meta(92)],
        ['bext', meta(603)],
      ],
      after: [['LGWV', meta(18)]],
    });
    const a = sliceStem(plain, readWavLayout(plain), 10, 400);
    const b = sliceStem(tagged, readWavLayout(tagged), 10, 400);
    expect(b).toEqual(a);
    expect(decodeFlac(b).channels.length).toBe(2);
  });

  it.each([16, 24])('keeps %i-bit depth', (bits) => {
    const src = buildWav({ samples: noiseBytes(64, bits / 8), bits });
    const layout = readWavLayout(src);
    expect(layout).toMatchObject({ bits, format: 1, channels: 1, frames: 64 });
    expect(decodeFlac(sliceStem(src, layout, 0, 64)).frames).toBe(64);
  });

  it.each([
    [{ rate: 44100 }, /sample rate 44100/],
    [{ bits: 8 }, /unsupported encoding \(format 1, 8-bit\)/],
    [{ channels: 3, bits: 16 }, /channel count 3/],
    [
      { bits: 32, format: 3 },
      /32-bit float is not supported: export float sources as 16- or 24-bit integer/,
    ],
  ])('refuses %o', (spec, message) => {
    const src = buildWav({ samples: new Uint8Array(48), ...spec });
    expect(() => readWavLayout(src)).toThrow(message);
  });

  it('refuses a range past the end', () => {
    const src = buildWav({ samples: noiseBytes(10, 3) });
    expect(() => sliceStem(src, readWavLayout(src), 5, 11)).toThrow(/past the source's 10 frames/);
  });
});
