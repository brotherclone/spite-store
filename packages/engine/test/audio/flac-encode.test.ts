import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { decodeFlac, encodeFlac } from '../../src/audio/flac.js';
import { testSignal } from '../helpers/flac.js';

const toFloat = (s: Int32Array, bits: 16 | 24) =>
  Float32Array.from(s, (v) => v / (bits === 16 ? 32768 : 8388608));

describe('encodeFlac: lossless round trip', () => {
  const kinds = ['silence', 'extremes', 'noise', 'sine'] as const;
  const cases = kinds.flatMap((kind) =>
    ([16, 24] as const).flatMap((bits) =>
      [1, 2].flatMap((channels) =>
        [1, 4095, 4096, 4097].map((frames) => ({ kind, bits, channels, frames })),
      ),
    ),
  );

  it.each(cases)(
    '$kind, $bits-bit, $channels ch, $frames frames',
    ({ kind, bits, channels, frames }) => {
      const input = Array.from({ length: channels }, (_, c) => testSignal(kind, bits, frames, c));
      const stem = decodeFlac(encodeFlac(input, bits), kind);
      expect(stem.frames).toBe(frames);
      expect(stem.channels).toEqual(input.map((s) => toFloat(s, bits)));
    },
  );

  it('round-trips a block of identical stereo channels and wasted low bits', () => {
    const left = Int32Array.from({ length: 9000 }, (_, i) => (((i * 37) % 2000) - 1000) * 256);
    const stem = decodeFlac(encodeFlac([left, left.slice()], 24));
    expect(stem.channels).toEqual([toFloat(left, 24), toFloat(left, 24)]);
  });

  it('rejects samples beyond the depth and bad shapes', () => {
    expect(() => encodeFlac([Int32Array.of(32768)], 16)).toThrow(RangeError);
    expect(() => encodeFlac([new Int32Array(2), new Int32Array(3)], 16)).toThrow(RangeError);
    expect(() => encodeFlac([new Int32Array(0)], 16)).toThrow(RangeError);
    expect(() => encodeFlac([new Int32Array(1), new Int32Array(1), new Int32Array(1)], 16)).toThrow(
      RangeError,
    );
  });

  it('compresses a predictable signal', () => {
    const sine = testSignal('sine', 24, 48000);
    expect(encodeFlac([sine], 24).length).toBeLessThan(48000 * 3 * 0.5);
  });
});

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** The encoder's output for each committed test signal (10,000 frames). See design D2. */
const PINNED: Record<string, string> = {
  'silence-16-1': '126195634211880fa617c7f8676a2c665b505e084b0cc459d1032cb9f5a0df3f',
  'silence-16-2': '7476a2840655880b3e171926519d1c285bae3436dce8a977a962db373637781b',
  'silence-24-1': '027120e88533b8f313897c7b539648a070ea2e5a2414e461cd52ce431e57d86f',
  'silence-24-2': 'e5ed7e808c0241cc16e6181a85c5dc29384fb5265ec7e4eedde8af2770122c25',
  'extremes-16-1': '597edb34a9a1b174ffe255a40cb7bda8d5c4b66c5e822bffa940986f98de3e38',
  'extremes-16-2': 'c3d8f80e014924d741e66314769a458c6cdb5474eabc18d55c3ae9fe1dbd182a',
  'extremes-24-1': '1ea0860883fb6ed8314f78f68cab90e5e618c26c68369270f8068b417a6c4871',
  'extremes-24-2': 'f9cdfb8372cafb0e44dfb5deac13ae8474e32df56befe6779b1de18a9852da3a',
  'noise-16-1': '47695eeeb7fd891a572c6f7861f247618e1a1569fc0ea28ac0a111b93947e6b1',
  'noise-16-2': 'd425a0dd45afa66b47a121605969de37d884fd71f567e8066f235792dbd55c61',
  'noise-24-1': 'e6dba8bab22516926e5ce0fcaa4df079b3c605b8356d8a54d24ec5372a8fe105',
  'noise-24-2': '8db70c50e25eb905abe0c83b0507b978fe5ee270429a1d184b757a52af44115d',
  'sine-16-1': '4fc337f4b134c2f1beb690435bda2d0e256c01f05c8355d9522b80f851fc838a',
  'sine-16-2': '4e6d3fec3a1b368b9d9c1467e5731b4ac864916263d57c023bb5ff38a716657b',
  'sine-24-1': '835880660d19d7faa81fe64d20babf1f64fd1c7a013697d27ab5a90dce24b778',
  'sine-24-2': '84793a64ad04d1d6962264aee69884b30197c393befa58a9a61f0c140da6677b',
};

const pinnedCases = Object.keys(PINNED).map((key) => {
  const [kind, bits, channels] = key.split('-') as [
    Parameters<typeof testSignal>[0],
    string,
    string,
  ];
  return { key, kind, bits: Number(bits) as 16 | 24, channels: Number(channels) };
});
const pinnedInput = (c: (typeof pinnedCases)[number]) =>
  Array.from({ length: c.channels }, (_, ch) => testSignal(c.kind, c.bits, 10000, ch));

describe('encodeFlac: canonical output', () => {
  it.each(pinnedCases)('$key matches its pinned hash', (c) => {
    expect(sha(encodeFlac(pinnedInput(c), c.bits))).toBe(PINNED[c.key]);
  });

  it('writes the same bytes in a bare ECMAScript context', () => {
    const bundle = readFileSync(join(import.meta.dirname, '../../dist/engine.iife.js'), 'utf8');
    const context = createContext({});
    runInContext(bundle, context);
    for (const c of pinnedCases) {
      const json = JSON.stringify(pinnedInput(c).map((s) => Array.from(s)));
      const bytes = runInContext(
        `SpiteEngine.encodeFlac(${json}.map(function (a) { return Int32Array.from(a); }), ${c.bits})`,
        context,
      ) as Uint8Array;
      expect(sha(bytes), c.key).toBe(PINNED[c.key]);
    }
  });
});

const hasFlac = spawnSync('flac', ['--version']).status === 0;

describe.skipIf(!hasFlac)('encodeFlac: the reference tool accepts the output', () => {
  it('passes flac --test for every pinned signal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spite-flac-test-'));
    try {
      for (const c of pinnedCases) {
        const file = join(dir, `${c.key}.flac`);
        writeFileSync(file, encodeFlac(pinnedInput(c), c.bits));
        const r = spawnSync('flac', ['--test', '--silent', file], { encoding: 'utf8' });
        expect(r.status, `${c.key}: ${r.stderr}`).toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
