import { describe, expect, it } from 'vitest';
import { decodeFlac } from '../../src/audio/flac.js';
import { encodeWav16 } from '../../src/audio/wav.js';
import { makeFlac } from '../helpers/flac.js';

const ramp = (n: number, scale: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ((i * 7919 + offset) % (2 * scale)) - scale);

describe('decodeFlac: accepted streams', () => {
  it('decodes 24-bit mono with the sample count from STREAMINFO', () => {
    const samples = ramp(3000, 8388608);
    const stem = decodeFlac(makeFlac({ bits: 24, channels: [samples] }), 'sha256:m');
    expect(stem.frames).toBe(3000);
    expect(stem.channels).toHaveLength(1);
    expect(Array.from(stem.channels[0]!)).toEqual(samples.map((v) => Math.fround(v / 8388608)));
  });

  it('decodes 16-bit stereo, dividing like the WAV decoder', () => {
    const left = ramp(2500, 32768);
    const right = ramp(2500, 32768, 11);
    const stem = decodeFlac(makeFlac({ bits: 16, channels: [left, right] }));
    expect(Array.from(stem.channels[0]!)).toEqual(left.map((v) => Math.fround(v / 32768)));
    expect(Array.from(stem.channels[1]!)).toEqual(right.map((v) => Math.fround(v / 32768)));
  });

  it('keeps the extremes exact', () => {
    const samples = [-8388608, 8388607, 0, -1, 1];
    const stem = decodeFlac(makeFlac({ bits: 24, channels: [samples], blockSize: 16 }));
    expect(Array.from(stem.channels[0]!)).toEqual(samples.map((v) => Math.fround(v / 8388608)));
  });

  it('rejects a 44.1 kHz stream, naming the stem and the rate', () => {
    const bytes = makeFlac({ rate: 44100, bits: 16, channels: [[0, 1, 2]] });
    expect(() => decodeFlac(bytes, 'sha256:abc')).toThrow(/sha256:abc: .*44100 Hz/);
  });

  it.each([8, 20])('rejects a %i-bit stream, naming the depth', (bits) => {
    const bytes = makeFlac({ bits, channels: [[0, 1, 2]] });
    expect(() => decodeFlac(bytes, 'x')).toThrow(new RegExp(`x: .*bits per sample ${bits}`));
  });

  it('rejects three channels', () => {
    const bytes = makeFlac({ bits: 16, channels: [[0], [0], [0]] });
    expect(() => decodeFlac(bytes, 'x')).toThrow(/x: unsupported channel count 3/);
  });

  it('rejects a WAV file as not FLAC', () => {
    expect(() => decodeFlac(encodeWav16([[0, 0.5]]), 'sha256:w')).toThrow(
      /sha256:w: not a FLAC stream/,
    );
  });

  it('rejects an unknown sample count', () => {
    const bytes = makeFlac({ bits: 16, channels: [[0, 1]], total: 0 });
    expect(() => decodeFlac(bytes, 'x')).toThrow(/x: unknown total sample count/);
  });
});

describe('decodeFlac: corrupt streams', () => {
  const valid = () => makeFlac({ bits: 24, channels: [ramp(5000, 8388608)], blockSize: 1024 });

  it('rejects a flipped byte inside an audio frame', () => {
    const bytes = valid();
    bytes[bytes.length - 2000] = bytes[bytes.length - 2000]! ^ 0x10;
    expect(() => decodeFlac(bytes, 'sha256:f')).toThrow(/sha256:f: .*CRC mismatch/);
  });

  it('rejects a flipped byte in a frame header', () => {
    const bytes = valid();
    bytes[42 + 4] = bytes[42 + 4]! ^ 0x01; // inside the first frame's header (after the 42-byte stream header)
    expect(() => decodeFlac(bytes, 'sha256:h')).toThrow(/sha256:h: /);
  });

  it('rejects a truncated stream', () => {
    const bytes = valid();
    expect(() => decodeFlac(bytes.subarray(0, bytes.length - 100), 'sha256:t')).toThrow(
      /sha256:t: FLAC stream is truncated/,
    );
  });

  it('rejects a sample count one more than the frames hold', () => {
    const samples = ramp(5000, 8388608);
    const bytes = makeFlac({ bits: 24, channels: [samples], total: 5001 });
    expect(() => decodeFlac(bytes, 'sha256:n')).toThrow(/sha256:n: /);
  });

  it('rejects a sample count one less than the frames hold', () => {
    const samples = ramp(5000, 8388608);
    const bytes = makeFlac({ bits: 24, channels: [samples], total: 4999 });
    expect(() => decodeFlac(bytes, 'sha256:n')).toThrow(/sha256:n: .*more samples than STREAMINFO/);
  });

  it('rejects data after the last frame', () => {
    const bytes = valid();
    const longer = new Uint8Array(bytes.length + 3);
    longer.set(bytes);
    expect(() => decodeFlac(longer, 'x')).toThrow(/x: data after the last frame/);
  });
});
