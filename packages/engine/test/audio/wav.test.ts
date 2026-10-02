import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav16 } from '../../src/audio/wav.js';

/** Independent WAV writer for tests (Buffer-based). */
function makeWav(opts: {
  format?: number;
  bits: number;
  channels: number;
  rate?: number;
  frames: number[][]; // frames[f][c] as raw integers (or floats for 32-bit float)
  extensible?: boolean;
  extraChunk?: boolean;
}): Uint8Array {
  const { bits, channels, frames } = opts;
  const rate = opts.rate ?? 48000;
  const format = opts.format ?? (bits === 32 ? 3 : 1);
  const bps = bits / 8;
  const data = Buffer.alloc(frames.length * channels * bps);
  let p = 0;
  for (const frame of frames) {
    for (const v of frame) {
      if (bits === 16) data.writeInt16LE(v, p);
      else if (bits === 24) data.writeIntLE(v, p, 3);
      else data.writeFloatLE(v, p);
      p += bps;
    }
  }
  const fmt = Buffer.alloc(opts.extensible ? 40 : 16);
  fmt.writeUInt16LE(opts.extensible ? 0xfffe : format, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * channels * bps, 8);
  fmt.writeUInt16LE(channels * bps, 12);
  fmt.writeUInt16LE(bits, 14);
  if (opts.extensible) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(bits, 18);
    fmt.writeUInt32LE(channels === 2 ? 3 : 4, 20);
    fmt.writeUInt16LE(format, 24);
  }
  const chunk = (id: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(id, 0, 'ascii');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const chunks = [chunk('fmt ', fmt)];
  if (opts.extraChunk) chunks.push(chunk('LIST', Buffer.from('odd')));
  chunks.push(chunk('data', data));
  const body = Buffer.concat([Buffer.from('WAVE'), ...chunks]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return new Uint8Array(Buffer.concat([head, body]));
}

describe('decodeWav', () => {
  it('decodes 16-bit, 24-bit and float32 stereo to the same values', () => {
    const s16 = decodeWav(
      makeWav({
        bits: 16,
        channels: 2,
        frames: [
          [16384, -16384],
          [0, 32767],
        ],
      }),
    );
    const s24 = decodeWav(
      makeWav({
        bits: 24,
        channels: 2,
        frames: [
          [4194304, -4194304],
          [0, 8388607],
        ],
      }),
    );
    const f32 = decodeWav(
      makeWav({
        bits: 32,
        channels: 2,
        frames: [
          [0.5, -0.5],
          [0, 1],
        ],
      }),
    );
    for (const s of [s16, s24, f32]) {
      expect(s.frames).toBe(2);
      expect(s.channels).toHaveLength(2);
      expect([s.channels[0]![0], s.channels[1]![0], s.channels[0]![1]]).toEqual([0.5, -0.5, 0]);
    }
    expect(s16.channels[1]![1]).toBe(32767 / 32768);
    expect(s24.channels[1]![1]).toBe(Math.fround(8388607 / 8388608));
    expect(f32.channels[1]![1]).toBe(1);
  });

  it('decodes mono, WAVE_FORMAT_EXTENSIBLE and skips unknown chunks', () => {
    const mono = decodeWav(
      makeWav({ bits: 16, channels: 1, frames: [[-32768], [8192]], extraChunk: true }),
    );
    expect(mono.channels).toHaveLength(1);
    expect(Array.from(mono.channels[0]!)).toEqual([-1, 0.25]);
    const ext = decodeWav(makeWav({ bits: 24, channels: 2, frames: [[1, -1]], extensible: true }));
    expect(ext.channels[0]![0]).toBe(1 / 8388608);
  });

  it('rejects unsupported audio, naming the stem and the property', () => {
    expect(() =>
      decodeWav(makeWav({ bits: 16, channels: 2, rate: 44100, frames: [[0, 0]] }), 'sha256:abc'),
    ).toThrow(/sha256:abc: unsupported sample rate 44100/);
    expect(() => decodeWav(makeWav({ bits: 16, channels: 3, frames: [[0, 0, 0]] }), 'x')).toThrow(
      /channel count 3/,
    );
    expect(() => decodeWav(makeWav({ bits: 8, channels: 1, frames: [] }), 'x')).toThrow(
      /unsupported encoding/,
    );
    expect(() => decodeWav(new Uint8Array([1, 2, 3]), 'x')).toThrow(/not a RIFF/);
  });
});

describe('encodeWav16', () => {
  it('writes a canonical 16-bit stereo 48 kHz file', () => {
    const left = [0, 0.5, 1.7, -2, -0.5];
    const right = [1, -1, 0.25, 0, 0.00001];
    const buf = Buffer.from(encodeWav16([left, right]));
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(buf.readUInt16LE(20)).toBe(1);
    expect(buf.readUInt16LE(22)).toBe(2);
    expect(buf.readUInt32LE(24)).toBe(48000);
    expect(buf.readUInt16LE(34)).toBe(16);
    expect(buf.readUInt32LE(40)).toBe(5 * 4);
    expect(buf.length).toBe(44 + 20);
    const samples = Array.from({ length: 10 }, (_, i) => buf.readInt16LE(44 + i * 2));
    // Interleaved L, R; 1.7 clips to 32767 and -2 to -32767; 0.5 * 32767 = 16383.5 rounds up.
    expect(samples).toEqual([0, 32767, 16384, -32767, 32767, 8192, -32767, 0, -16383, 0]);
  });

  it('round-trips through decodeWav', () => {
    const tone = Array.from({ length: 64 }, (_, i) => ((i % 16) - 8) / 8);
    const decoded = decodeWav(encodeWav16([tone]));
    expect(decoded.frames).toBe(64);
    decoded.channels[0]!.forEach((v, i) => expect(Math.abs(v - tone[i]!)).toBeLessThan(1 / 16384));
  });
});
