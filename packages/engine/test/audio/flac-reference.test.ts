import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeFlac } from '../../src/audio/flac.js';
import { decodeWav } from '../../src/audio/wav.js';

/** The reference encoder, when installed. Tests that need it are skipped (with a note) otherwise. */
export const hasFlac = spawnSync('flac', ['--version']).status === 0;
if (!hasFlac) console.warn('flac is not on PATH: skipping the reference-encoder tests');

/** A plain integer PCM WAV (16- or 24-bit) for feeding the reference encoder. */
export function intWav(bits: 16 | 24, channels: number[][]): Buffer {
  const frames = channels[0]!.length;
  const bps = bits / 8;
  const data = Buffer.alloc(frames * channels.length * bps);
  let p = 0;
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) {
      data.writeIntLE(ch[i]!, p, bps);
      p += bps;
    }
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(channels.length, 22);
  head.writeUInt32LE(48000, 24);
  head.writeUInt32LE(48000 * channels.length * bps, 28);
  head.writeUInt16LE(channels.length * bps, 32);
  head.writeUInt16LE(bits, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** A test signal with structure for predictors and stereo modes to find: tone, noise, silence. */
function signal(bits: 16 | 24, frames: number, seed: number): number[] {
  const max = bits === 16 ? 32767 : 8388607;
  let x = seed;
  return Array.from({ length: frames }, (_, i) => {
    x = (x * 1103515245 + 12345) % 2147483648;
    if (i > frames * 0.8) return 0;
    const tone = Math.round(Math.sin(i / (20 + seed)) * max * 0.6);
    const noise = Math.round(((x / 2147483648) * 2 - 1) * max * 0.05);
    return Math.max(-max - 1, Math.min(max, tone + noise));
  });
}

const dir = mkdtempSync(join(tmpdir(), 'spite-flac-ref-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!hasFlac)("decodeFlac reads the reference encoder's output", () => {
  const cases = [16, 24].flatMap((bits) =>
    [1, 2].flatMap((channels) => [0, 5, 8].map((level) => ({ bits, channels, level }))),
  ) as { bits: 16 | 24; channels: number; level: number }[];

  it.each(cases)('$bits-bit, $channels ch, level $level', ({ bits, channels, level }) => {
    const left = signal(bits, 20000, 3);
    // The second channel is close to the first, so the encoder picks side and mid/side modes.
    const right = left.map((v, i) => (i % 97 === 0 ? 0 : Math.trunc(v * 0.9)));
    const wav = intWav(bits, channels === 1 ? [left] : [left, right]);
    const name = `s${bits}-${channels}-${level}`;
    writeFileSync(join(dir, `${name}.wav`), wav);
    execFileSync(
      'flac',
      ['-s', `-${level}`, '-f', '-o', join(dir, `${name}.flac`), join(dir, `${name}.wav`)],
      { stdio: 'pipe' },
    );
    const fromFlac = decodeFlac(new Uint8Array(readFileSync(join(dir, `${name}.flac`))), name);
    const fromWav = decodeWav(new Uint8Array(wav), name);
    expect(fromFlac.frames).toBe(fromWav.frames);
    expect(fromFlac.channels).toEqual(fromWav.channels);
  });
});
