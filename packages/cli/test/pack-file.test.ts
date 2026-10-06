import type { Manifest } from '@spite-store/engine';
import { describe, expect, it } from 'vitest';
import { checkPackFile, planSlices, readLayouts, type PackFile } from '../src/pack.js';
import { buildWav, noiseBytes } from './wav-fixtures.js';

const hash = `sha256:${'0'.repeat(64)}`;

const manifest = {
  specVersion: '0.1',
  id: 'p',
  tempo: [{ bar: 0, bpm: 63, meter: [7, 8] }],
  clips: { a: { hash, lengthBars: 4 }, b: { hash, lengthBars: 4 } },
  start: 's',
  sections: [{ id: 's', lengthBars: 4 }],
} as unknown as Manifest;

const pack = (): PackFile => ({
  sources: { src: { file: 'Maria/Cello close.wav', sha256: hash } },
  clips: {
    a: { source: 'src', startBar: 0, bars: 5 },
    b: { source: 'src', startBar: 5, bars: 5 },
  },
});

describe('checkPackFile', () => {
  it('accepts a pack file that covers the catalogue', () => {
    expect(checkPackFile(pack(), manifest)).toEqual([]);
  });

  it('refuses entries for unknown clips and sources, and uncovered clips', () => {
    const p = pack() as unknown as { clips: Record<string, unknown> };
    p.clips.z = { source: 'src', startBar: 0, bars: 5 };
    p.clips.a = { source: 'nope', startBar: 0, bars: 5 };
    delete p.clips.b;
    expect(checkPackFile(p, manifest)).toEqual([
      'pack entry "a" names unknown source "nope"',
      'pack entry "z" names a clip that is not in the manifest',
      'clip "b" has no pack entry',
    ]);
  });

  it('refuses absolute paths', () => {
    const p = pack();
    p.sources.src!.file = '/Users/me/Cello close.wav';
    expect(checkPackFile(p, manifest)[0]).toMatch(/absolute path/);
  });

  it('refuses a slice shorter than the clip body', () => {
    const p = pack();
    p.clips.a!.bars = 3;
    expect(checkPackFile(p, manifest)).toEqual([
      `pack entry "a" slices 3 bar(s), shorter than the clip's lengthBars 4`,
    ]);
  });

  it('refuses malformed bars', () => {
    const p = pack() as unknown as { clips: Record<string, Record<string, unknown>> };
    p.clips.a!.startBar = -1;
    p.clips.b!.bars = 1.5;
    expect(checkPackFile(p, manifest)).toHaveLength(2);
  });
});

describe('planSlices', () => {
  const sources = (frames: number) =>
    new Map([['src', { bytes: buildWav({ samples: noiseBytes(frames, 3) }), sha256: hash }]]);

  it('cuts at exact bar frames at 63 BPM in 7/8', () => {
    const { layouts } = readLayouts(sources(2_400_000));
    const { slices, problems } = planSlices(pack(), manifest, layouts);
    expect(problems).toEqual([]);
    expect(slices).toEqual([
      { clip: 'a', source: 'src', start: 0, end: 800_000 },
      { clip: 'b', source: 'src', start: 800_000, end: 1_600_000 },
    ]);
  });

  it('refuses a range past the end of the source', () => {
    const { layouts } = readLayouts(sources(1_000_000));
    const { problems } = planSlices(pack(), manifest, layouts);
    expect(problems).toEqual([
      'pack entry "b" needs frames 800000-1600000 but source "src" has only 1000000 frames',
    ]);
  });

  it('names a source in the wrong format', () => {
    const bad = new Map([
      ['src', { bytes: buildWav({ samples: new Uint8Array(30), rate: 44100 }), sha256: hash }],
    ]);
    expect(readLayouts(bad).problems).toEqual([
      'source "src": unsupported sample rate 44100 Hz (expected 48000)',
    ]);
  });
});
