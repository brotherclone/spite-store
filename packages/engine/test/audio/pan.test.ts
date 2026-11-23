import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  planRender,
  realizeForRender,
  renderAll,
  renderWav,
  type Manifest,
  type Stem,
  type TraceEvent,
} from '../../src/index.js';
import { clips, hashOf, manifest } from '../helpers/manifests.js';
import { panned } from '../helpers/panned.js';
import { loadPlaceholder, placeholderStems, repoRoot, sha256 } from '../helpers/placeholder.js';

const BAR = 96000;

/** Interleaves L/R into float32, as the float32 snapshots do. */
function float32Interleaved(left: Float64Array, right: Float64Array): Float32Array {
  const out = new Float32Array(left.length * 2);
  for (let f = 0; f < left.length; f++) {
    out[2 * f] = left[f]!;
    out[2 * f + 1] = right[f]!;
  }
  return out;
}
const m = manifest({
  clips: clips({ a: 1 }),
  sections: [{ id: 's', lengthBars: 1, slots: [{ id: 'x', pool: [{ clip: 'a', weight: 1 }] }] }],
});
const one = (gain: number, pan: number): TraceEvent[] => [
  { bar: 0, beat: 0, slot: 'x', clipHash: hashOf('a'), gain, pan },
];
const constant = (value: number, right?: number): Stem => {
  const l = new Float32Array(BAR).fill(value);
  return {
    frames: BAR,
    channels: right === undefined ? [l] : [l, new Float32Array(BAR).fill(right)],
  };
};
const same = (a: Float64Array, value: number) => a.every((v) => v === value);

describe('pan law', () => {
  it('turns down the far side of a mono stem panned left', () => {
    const stems = new Map([[hashOf('a'), constant(0.5)]]);
    const { left, right } = renderAll(planRender(m, one(1, -0.5), 1, stems), stems);
    expect(same(left, 0.5)).toBe(true);
    expect(same(right, 0.25)).toBe(true);
  });

  it('silences the left channel of a stereo stem panned hard right', () => {
    const stems = new Map([[hashOf('a'), constant(0.4, 0.8)]]);
    const { left, right } = renderAll(planRender(m, one(0.5, 1), 1, stems), stems);
    expect(same(left, 0)).toBe(true);
    expect(same(right, Math.fround(0.8) * 0.5)).toBe(true);
  });

  it('keeps the near side at unity across the range', () => {
    const stems = new Map([[hashOf('a'), constant(0.5)]]);
    for (const pan of [-1, -0.25, 0.25, 1]) {
      const { left, right } = renderAll(planRender(m, one(1, pan), 1, stems), stems);
      expect(pan < 0 ? left[0] : right[0]).toBe(0.5);
      expect(pan < 0 ? right[0] : left[0]).toBe(0.5 * (1 - Math.abs(pan)));
    }
  });
});

describe('centre and absent pan render the same samples', () => {
  const { manifest: placeholder } = loadPlaceholder();
  const stems = placeholderStems();
  const centred = (): Manifest => {
    const copy = structuredClone(placeholder);
    for (const section of copy.sections) for (const slot of section.slots ?? []) slot.pan = 0;
    return copy;
  };
  const snapshot = (kind: 'audio' | 'float32') =>
    JSON.parse(
      readFileSync(join(repoRoot, 'fixtures/golden', `placeholder.${kind}.42.json`), 'utf8'),
    ) as { durationBars: number; wavSha256: string; float32Sha256: string };

  it.each([
    ['as committed', () => placeholder],
    ['with pan 0 on every slot', centred],
  ])('matches the golden WAV and float32 snapshots %s', (_label, make) => {
    const piece = make();
    const audio = snapshot('audio');
    expect(sha256(renderWav(piece, 42, { durationBars: audio.durationBars }, stems).wav)).toBe(
      audio.wavSha256,
    );
    const f = snapshot('float32');
    const { events, endBar } = realizeForRender(piece, 42, { durationBars: f.durationBars });
    const { left, right } = renderAll(planRender(piece, events, endBar, stems), stems);
    expect(sha256(new Uint8Array(float32Interleaved(left, right).buffer))).toBe(f.float32Sha256);
  });

  it('carries pan 0 in the trace when declared', () => {
    const { events } = realizeForRender(centred(), 42, { durationBars: 16 });
    expect(events.every((e) => e.pan === 0)).toBe(true);
  });
});

describe('panned render is the same everywhere', () => {
  it('gives the same float32 samples in a bare ECMAScript context', () => {
    const piece = panned(loadPlaceholder().manifest);
    const stems = placeholderStems();
    const { events, endBar } = realizeForRender(piece, 42, { durationBars: 16 });
    expect(events.some((e) => e.pan !== undefined && e.pan !== Math.trunc(e.pan))).toBe(true);
    const { left, right } = renderAll(planRender(piece, events, endBar, stems), stems);
    const node = sha256(new Uint8Array(float32Interleaved(left, right).buffer));
    expect(left).not.toEqual(right);

    const context = createContext({});
    runInContext(
      readFileSync(join(import.meta.dirname, '../../dist/engine.iife.js'), 'utf8'),
      context,
    );
    const stemData = [...stems].map(([hash, s]) => [hash, s.channels.map((c) => Array.from(c))]);
    const bare = runInContext(
      `(function (m, data) {
        var stems = new Map(data.map(function (d) {
          var ch = d[1].map(function (c) { return Float32Array.from(c); });
          return [d[0], { frames: ch[0].length, channels: ch }];
        }));
        var r = SpiteEngine.realizeForRender(m, 42, { durationBars: 16 });
        var out = SpiteEngine.renderAll(SpiteEngine.planRender(m, r.events, r.endBar, stems), stems);
        var f = new Float32Array(out.left.length * 2);
        for (var i = 0; i < out.left.length; i++) { f[2 * i] = out.left[i]; f[2 * i + 1] = out.right[i]; }
        return new Uint8Array(f.buffer);
      })(${JSON.stringify(piece)}, ${JSON.stringify(stemData)})`,
      context,
    ) as Uint8Array;
    expect(sha256(bare)).toBe(node);
  });
});
