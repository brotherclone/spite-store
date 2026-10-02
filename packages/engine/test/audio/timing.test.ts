import { describe, expect, it } from 'vitest';
import { barFrame } from '../../src/audio/timing.js';
import type { Manifest } from '../../src/manifest.js';

const withTempo = (tempo: Manifest['tempo']): Manifest => ({ tempo }) as unknown as Manifest;

describe('barFrame', () => {
  it('maps bars at constant tempo', () => {
    const m = withTempo([{ bar: 0, bpm: 120, meter: [4, 4] }]);
    for (const b of [0, 1, 2, 17, 999]) expect(barFrame(m, b)).toBe(96000 * b);
  });

  it('handles meter and tempo changes', () => {
    const m = withTempo([
      { bar: 0, bpm: 90, meter: [4, 4] },
      { bar: 2, bpm: 120, meter: [6, 8] },
    ]);
    expect(barFrame(m, 1)).toBe(128000);
    expect(barFrame(m, 2)).toBe(256000);
    expect(barFrame(m, 3)).toBe(328000);
  });

  it('does not drift over 1,000 bars', () => {
    const m = withTempo([{ bar: 0, bpm: 97, meter: [4, 4] }]);
    for (let b = 0; b <= 1000; b++) {
      // Exact reference with BigInt: round half up of b * 11520000 / 97.
      const num = BigInt(b) * 11520000n * 2n + 97n;
      const expected = Number(num / (2n * 97n));
      expect(barFrame(m, b)).toBe(expected);
    }
  });

  it('rejects invalid bars', () => {
    const m = withTempo([{ bar: 0, bpm: 120, meter: [4, 4] }]);
    expect(() => barFrame(m, -1)).toThrow(RangeError);
    expect(() => barFrame(m, 1.5)).toThrow(RangeError);
  });
});
