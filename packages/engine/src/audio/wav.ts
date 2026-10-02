import { SAMPLE_RATE } from './timing.js';

/** Decoded stem audio: one (mono) or two (stereo) channels of equal length, as Float32. */
export interface Stem {
  channels: Float32Array[];
  frames: number;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function fourcc(view: DataView, offset: number): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

/**
 * Decodes a RIFF/WAVE file: PCM 16/24-bit or float32, 48 kHz, mono or stereo. Every accepted
 * encoding converts to Float32 exactly, so decoding is identical on every runtime. `name` labels
 * errors (typically the stem's hash).
 */
export function decodeWav(bytes: Uint8Array, name = 'stem'): Stem {
  const fail = (what: string): never => {
    throw new Error(`${name}: ${what}`);
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || fourcc(view, 0) !== 'RIFF' || fourcc(view, 8) !== 'WAVE') {
    fail('not a RIFF/WAVE file');
  }

  let format = -1;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: { offset: number; length: number } | null = null;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const id = fourcc(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.byteLength) fail(`chunk "${id}" is truncated`);
    if (id === 'fmt ') {
      if (size < 16) fail('fmt chunk is too short');
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === FORMAT_EXTENSIBLE) {
        if (size < 40) fail('extensible fmt chunk is too short');
        format = view.getUint16(body + 24, true);
      }
    } else if (id === 'data') {
      data = { offset: body, length: size };
    }
    offset = body + size + (size & 1);
  }

  if (format === -1) fail('missing fmt chunk');
  if (data === null) fail('missing data chunk');
  if (rate !== SAMPLE_RATE) fail(`unsupported sample rate ${rate} Hz (expected ${SAMPLE_RATE})`);
  if (channels !== 1 && channels !== 2)
    fail(`unsupported channel count ${channels} (expected 1 or 2)`);
  const pcm = format === FORMAT_PCM && (bits === 16 || bits === 24);
  const float = format === FORMAT_FLOAT && bits === 32;
  if (!pcm && !float) fail(`unsupported encoding (format ${format}, ${bits}-bit)`);

  const bytesPerSample = bits / 8;
  const frames = Math.floor(data!.length / (bytesPerSample * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  let p = data!.offset;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      let v: number;
      if (bits === 16) {
        v = view.getInt16(p, true) / 32768;
      } else if (bits === 24) {
        const raw = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getUint8(p + 2) << 16);
        v = ((raw << 8) >> 8) / 8388608;
      } else {
        v = view.getFloat32(p, true);
      }
      out[c]![f] = v;
      p += bytesPerSample;
    }
  }
  return { channels: out, frames };
}

/** Clip to [-1, 1], scale by 32767 and round half up. No dither. */
export function quantize16(x: number): number {
  const clipped = x > 1 ? 1 : x < -1 ? -1 : x;
  return Math.floor(clipped * 32767 + 0.5);
}

/** Encodes one or two equal-length channels as a canonical 16-bit 48 kHz PCM WAV file. */
export function encodeWav16(channels: readonly ArrayLike<number>[]): Uint8Array {
  const count = channels.length;
  if (count !== 1 && count !== 2) throw new RangeError('encodeWav16 needs 1 or 2 channels');
  const frames = channels[0]!.length;
  if (channels.some((c) => c.length !== frames)) throw new RangeError('channel lengths differ');
  const dataBytes = frames * count * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, count, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  let p = 44;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < count; c++) {
      view.setInt16(p, quantize16(channels[c]![f]!), true);
      p += 2;
    }
  }
  return bytes;
}
