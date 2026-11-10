import { SAMPLE_RATE } from '@spite-store/engine';

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

/** Where a WAV file's sample bytes sit, and the format they are in. */
export interface WavLayout {
  /** 1 (integer PCM) or 3 (float), with any extensible header unwrapped. */
  format: number;
  channels: number;
  rate: number;
  bits: number;
  /** Bytes per frame (all channels). */
  blockAlign: number;
  dataOffset: number;
  frames: number;
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/**
 * Reads a RIFF/WAVE file's format and the byte range of its samples, applying the same acceptance
 * rules as the renderer (48 kHz, 1 or 2 channels, 16/24-bit integer or 32-bit float). Throws an
 * Error naming the unsupported property otherwise.
 */
export function readWavLayout(bytes: Uint8Array): WavLayout {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let fmt: Omit<WavLayout, 'dataOffset' | 'frames' | 'blockAlign'> | null = null;
  let data: { offset: number; length: number } | null = null;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const id = fourcc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.byteLength) throw new Error(`chunk "${id}" is truncated`);
    if (id === 'fmt ') {
      if (size < 16) throw new Error('fmt chunk is too short');
      let format = view.getUint16(body, true);
      if (format === FORMAT_EXTENSIBLE) {
        if (size < 40) throw new Error('extensible fmt chunk is too short');
        format = view.getUint16(body + 24, true);
      }
      fmt = {
        format,
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      data = { offset: body, length: size };
    }
    offset = body + size + (size & 1);
  }
  if (fmt === null) throw new Error('missing fmt chunk');
  if (data === null) throw new Error('missing data chunk');
  if (fmt.rate !== SAMPLE_RATE) {
    throw new Error(`unsupported sample rate ${fmt.rate} Hz (expected ${SAMPLE_RATE})`);
  }
  if (fmt.channels !== 1 && fmt.channels !== 2) {
    throw new Error(`unsupported channel count ${fmt.channels} (expected 1 or 2)`);
  }
  const pcm = fmt.format === FORMAT_PCM && (fmt.bits === 16 || fmt.bits === 24);
  const float = fmt.format === FORMAT_FLOAT && fmt.bits === 32;
  if (!pcm && !float) {
    throw new Error(`unsupported encoding (format ${fmt.format}, ${fmt.bits}-bit)`);
  }
  const blockAlign = (fmt.bits / 8) * fmt.channels;
  return {
    ...fmt,
    blockAlign,
    dataOffset: data.offset,
    frames: Math.floor(data.length / blockAlign),
  };
}

/**
 * Writes frames `[start, end)` of a source as a canonical WAV: a plain 16-byte `fmt ` chunk and a
 * `data` chunk holding the source's sample bytes unchanged. No metadata is carried over, so the
 * result depends only on the audio.
 */
export function sliceWav(
  bytes: Uint8Array,
  layout: WavLayout,
  start: number,
  end: number,
): Uint8Array {
  if (!(Number.isInteger(start) && Number.isInteger(end) && 0 <= start && start <= end)) {
    throw new RangeError(`invalid frame range ${start}-${end}`);
  }
  if (end > layout.frames) {
    throw new RangeError(`frame range ends at ${end}, past the source's ${layout.frames} frames`);
  }
  const dataBytes = (end - start) * layout.blockAlign;
  const pad = dataBytes & 1;
  const out = new Uint8Array(44 + dataBytes + pad);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < 4; i++) out[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes + pad, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, layout.format, true);
  view.setUint16(22, layout.channels, true);
  view.setUint32(24, layout.rate, true);
  view.setUint32(28, layout.rate * layout.blockAlign, true);
  view.setUint16(32, layout.blockAlign, true);
  view.setUint16(34, layout.bits, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  const from = layout.dataOffset + start * layout.blockAlign;
  out.set(bytes.subarray(from, from + dataBytes), 44);
  return out;
}
