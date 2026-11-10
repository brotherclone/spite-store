/** Builds WAV files for tests, with control over the header and extra chunks. */
export interface WavSpec {
  /** Raw sample bytes (already encoded, interleaved). */
  samples: Uint8Array;
  channels?: number;
  rate?: number;
  bits?: number;
  /** 1 (PCM) or 3 (float). */
  format?: number;
  extensible?: boolean;
  /** Chunks written before `fmt ` and after `data`, as [id, body]. */
  before?: [string, Uint8Array][];
  after?: [string, Uint8Array][];
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const pad = body.length & 1;
  const out = new Uint8Array(8 + body.length + pad);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

export function buildWav(spec: WavSpec): Uint8Array {
  const channels = spec.channels ?? 1;
  const rate = spec.rate ?? 48000;
  const bits = spec.bits ?? 24;
  const format = spec.format ?? 1;
  const blockAlign = (bits / 8) * channels;
  const fmt = new Uint8Array(spec.extensible ? 40 : 16);
  const v = new DataView(fmt.buffer);
  v.setUint16(0, spec.extensible ? 0xfffe : format, true);
  v.setUint16(2, channels, true);
  v.setUint32(4, rate, true);
  v.setUint32(8, rate * blockAlign, true);
  v.setUint16(12, blockAlign, true);
  v.setUint16(14, bits, true);
  if (spec.extensible) {
    v.setUint16(16, 22, true);
    v.setUint16(18, bits, true);
    v.setUint32(20, channels === 1 ? 4 : 3, true);
    v.setUint16(24, format, true);
    // Rest of the subformat GUID: 00000000-0010-8000-00AA00389B71 after the format code.
    fmt.set([0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71], 26);
  }
  const parts = [
    ...(spec.before ?? []).map(([id, body]) => chunk(id, body)),
    chunk('fmt ', fmt),
    chunk('data', spec.samples),
    ...(spec.after ?? []).map(([id, body]) => chunk(id, body)),
  ];
  const size = 4 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(8 + size);
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(out.buffer).setUint32(4, size, true);
  out.set([0x57, 0x41, 0x56, 0x45], 8);
  let offset = 12;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** `frames` frames of deterministic, non-repeating-looking bytes. */
export function noiseBytes(frames: number, blockAlign: number, salt = 0): Uint8Array {
  const out = new Uint8Array(frames * blockAlign);
  let x = 0x9e3779b9 ^ salt;
  for (let i = 0; i < out.length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}
