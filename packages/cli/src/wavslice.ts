import { SAMPLE_RATE, decodeFlac, encodeFlac } from '@spite-store/engine';

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

/** Where a WAV file's sample bytes sit, and the format they are in. */
export interface WavLayout {
  /** 1 (integer PCM), with any extensible header unwrapped. */
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
 * Reads a RIFF/WAVE source's format and the byte range of its samples. Accepts 48 kHz, 1 or 2
 * channels, 16- or 24-bit integer PCM: what a FLAC stem can hold. Throws an Error naming the
 * unsupported property otherwise.
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
  if (fmt.format === FORMAT_FLOAT) {
    throw new Error(
      `${fmt.bits}-bit float is not supported: export float sources as 16- or 24-bit integer`,
    );
  }
  const pcm = fmt.format === FORMAT_PCM && (fmt.bits === 16 || fmt.bits === 24);
  if (!pcm) {
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

/** Frames `[start, end)` of a source as one Int32Array of integer samples per channel. */
export function readFrames(
  bytes: Uint8Array,
  layout: WavLayout,
  start: number,
  end: number,
): Int32Array[] {
  if (!(Number.isInteger(start) && Number.isInteger(end) && 0 <= start && start <= end)) {
    throw new RangeError(`invalid frame range ${start}-${end}`);
  }
  if (end > layout.frames) {
    throw new RangeError(`frame range ends at ${end}, past the source's ${layout.frames} frames`);
  }
  const frames = end - start;
  const out = Array.from({ length: layout.channels }, () => new Int32Array(frames));
  const bps = layout.bits / 8;
  let p = layout.dataOffset + start * layout.blockAlign;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < layout.channels; c++) {
      out[c]![f] =
        bps === 2
          ? ((bytes[p]! | (bytes[p + 1]! << 8)) << 16) >> 16
          : ((bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16)) << 8) >> 8;
      p += bps;
    }
  }
  return out;
}

/**
 * Encodes frames `[start, end)` of a source as a canonical FLAC stem at the source's depth. The
 * stem holds only the audio, so it depends on nothing else in the file (metadata, header form).
 * The stem is decoded and checked against the source's samples before it is returned.
 */
export function sliceStem(
  bytes: Uint8Array,
  layout: WavLayout,
  start: number,
  end: number,
): Uint8Array {
  const samples = readFrames(bytes, layout, start, end);
  const stem = encodeFlac(samples, layout.bits as 16 | 24);
  const decoded = decodeFlac(stem, 'stem');
  const divisor = layout.bits === 16 ? 32768 : 8388608;
  for (let c = 0; c < samples.length; c++) {
    const want = samples[c]!;
    const got = decoded.channels[c]!;
    for (let i = 0; i < want.length; i++) {
      if (got[i]! * divisor !== want[i]) {
        throw new Error(`FLAC round trip failed at frame ${start + i}, channel ${c}`);
      }
    }
  }
  return stem;
}
