import { describe, expect, it } from 'vitest';
import { decodeFlac } from '../../src/audio/flac.js';
import { encodeTrackFlac, quantize24 } from '../../src/audio/wav.js';

describe('track audio', () => {
  it('quantizes with the 24-bit rule', () => {
    expect([-1.5, -1, 0, 0.5, 1].map(quantize24)).toEqual([
      -8388607, -8388607, 0, 4194304, 8388607,
    ]);
  });

  it('rounds half up and clips above 1', () => {
    expect(quantize24(1.5)).toBe(8388607);
    expect(quantize24(0.5 / 8388607)).toBe(1);
    expect(quantize24(-0.5 / 8388607)).toBe(0);
  });

  it('round-trips through decodeFlac to the quantized integers exactly', () => {
    const frames = 10_000;
    const left = new Float64Array(frames);
    const right = new Float64Array(frames);
    for (let i = 0; i < frames; i++) {
      left[i] = ((i * 7919) % 20001) / 10000 - 1;
      right[i] = i % 97 === 0 ? 1.25 : -((i * 104729) % 30011) / 15005.5 + 1;
    }
    const bytes = encodeTrackFlac(left, right);
    const stem = decodeFlac(bytes, 'track');
    expect(stem.frames).toBe(frames);
    expect(stem.channels).toHaveLength(2);
    for (let i = 0; i < frames; i++) {
      // The decoder divides by 2^23; scale back to the stored integer.
      expect(Math.round(stem.channels[0]![i]! * 8388608)).toBe(quantize24(left[i]!));
      expect(Math.round(stem.channels[1]![i]! * 8388608)).toBe(quantize24(right[i]!));
    }
    // STREAMINFO: 48 kHz, 2 channels, 24 bits.
    const info = bytes.subarray(8, 8 + 34);
    const rate = (info[10]! << 12) | (info[11]! << 4) | (info[12]! >> 4);
    const channels = ((info[12]! >> 1) & 7) + 1;
    const bits = (((info[12]! & 1) << 4) | (info[13]! >> 4)) + 1;
    expect([rate, channels, bits]).toEqual([48000, 2, 24]);
  });

  it('refuses channels of different lengths', () => {
    expect(() => encodeTrackFlac(new Float64Array(3), new Float64Array(4))).toThrow(RangeError);
  });
});
