import { decodeWav } from '@spite-store/engine';
import { describe, expect, it } from 'vitest';
import { readWavLayout, sliceWav } from '../src/wavslice.js';
import { buildWav, noiseBytes } from './wav-fixtures.js';

const meta = (n: number): Uint8Array => new Uint8Array(n).fill(0x42);

describe('readWavLayout and sliceWav', () => {
  it('copies the source bytes for the range unchanged', () => {
    const samples = noiseBytes(1000, 3);
    const src = buildWav({ samples });
    const out = sliceWav(src, readWavLayout(src), 100, 351);
    expect(out.length).toBe(44 + 251 * 3 + 1); // odd data length gets a pad byte
    expect(out.subarray(44, 44 + 251 * 3)).toEqual(samples.subarray(300, 1053));
    const stem = decodeWav(out);
    expect(stem.frames).toBe(251);
    expect(stem.channels.length).toBe(1);
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
    const a = sliceWav(plain, readWavLayout(plain), 10, 400);
    const b = sliceWav(tagged, readWavLayout(tagged), 10, 400);
    expect(b).toEqual(a);
    expect(decodeWav(b).channels.length).toBe(2);
  });

  it.each([
    [16, 1],
    [24, 1],
    [32, 3],
  ])('keeps %i-bit format %i and passes decodeWav', (bits, format) => {
    const samples =
      format === 3
        ? new Uint8Array(new Float32Array(64).fill(0.25).buffer)
        : noiseBytes(64, bits / 8);
    const src = buildWav({ samples, bits, format });
    const layout = readWavLayout(src);
    expect(layout).toMatchObject({ bits, format, channels: 1, frames: 64 });
    const stem = decodeWav(sliceWav(src, layout, 0, 64));
    expect(stem.frames).toBe(64);
    if (format === 3) expect(stem.channels[0]![0]).toBe(0.25);
  });

  it.each([
    [{ rate: 44100 }, /sample rate 44100/],
    [{ bits: 8 }, /unsupported encoding \(format 1, 8-bit\)/],
    [{ channels: 3, bits: 16 }, /channel count 3/],
  ])('refuses %o', (spec, message) => {
    const src = buildWav({ samples: new Uint8Array(48), ...spec });
    expect(() => readWavLayout(src)).toThrow(message);
  });

  it('refuses a range past the end', () => {
    const src = buildWav({ samples: noiseBytes(10, 3) });
    expect(() => sliceWav(src, readWavLayout(src), 5, 11)).toThrow(/past the source's 10 frames/);
  });
});
