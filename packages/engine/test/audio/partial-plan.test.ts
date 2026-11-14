import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  barFrame,
  createRenderState,
  encodeWav16,
  planRender,
  planRenderPartial,
  realizeForRender,
  renderAll,
  renderBlock,
  type Stem,
} from '../../src/index.js';
import { loadPlaceholder, placeholderStems, repoRoot, sha256 } from '../helpers/placeholder.js';

const { manifest } = loadPlaceholder();
const stems = placeholderStems();
const performance = (seed: string, bars: number) =>
  realizeForRender(manifest, seed, { durationBars: bars });

/** The stems whose first use is at or before `bar`. */
function stemsUsedBy(events: { bar: number; clipHash: string }[], bar: number) {
  const subset = new Map<string, Stem>();
  for (const e of events) if (e.bar <= bar) subset.set(e.clipHash, stems.get(e.clipHash)!);
  return subset;
}

describe('planRenderPartial', () => {
  it.each(['0', '42', 'spite-store'])(
    'with every stem present equals the full plan (seed %s)',
    (seed) => {
      const { events, endBar } = performance(seed, 16);
      const partial = planRenderPartial(manifest, events, endBar, stems);
      expect(partial.final).toBe(true);
      expect(partial.pending).toEqual([]);
      expect(partial.horizon).toBe(partial.plan.totalFrames);
      expect(partial.plan).toEqual(planRender(manifest, events, endBar, stems));
    },
  );

  it('with every stem present renders the golden audio for seed 42', () => {
    const { events, endBar } = performance('42', 16);
    const { plan } = planRenderPartial(manifest, events, endBar, stems);
    const { left, right } = renderAll(plan, stems);
    const golden = JSON.parse(
      readFileSync(join(repoRoot, 'fixtures/golden/placeholder.audio.42.json'), 'utf8'),
    );
    expect(sha256(encodeWav16([left, right]))).toBe(golden.wavSha256);
  });

  // Stem subsets for seed 42: the first k stems in order of first use, for every k that leaves
  // something out, and every stem but one from the middle of that order.
  const subsets = (() => {
    const { events } = performance('42', 16);
    const order = [...new Set(events.map((e) => e.clipHash))];
    const pick = (hashes: string[]) => new Map(hashes.map((h) => [h, stems.get(h)!]));
    const cases: [string, Map<string, Stem>][] = [];
    for (let k = 1; k < order.length; k++)
      cases.push([`first ${k} stems`, pick(order.slice(0, k))]);
    const middle = Math.floor(order.length / 2);
    cases.push([`all but stem ${middle + 1}`, pick(order.filter((_, i) => i !== middle))]);
    return cases;
  })();
  const bytes = (a: Float64Array, frames: number) =>
    sha256(new Uint8Array(a.buffer, a.byteOffset, frames * 8));

  it('has at least three stem subsets to test', () => {
    expect(subsets.length).toBeGreaterThanOrEqual(3);
  });

  it.each(subsets)('renders frames before the horizon exactly, with %s', (_, subset) => {
    const { events, endBar } = performance('42', 16);
    const partial = planRenderPartial(manifest, events, endBar, subset);
    const firstMissing = events.find((e) => !subset.has(e.clipHash))!;
    expect(partial.final).toBe(false);
    expect(partial.horizon).toBe(barFrame(manifest, firstMissing.bar));

    const full = renderAll(planRender(manifest, events, endBar, stems), stems);
    const part = renderBlock(partial.plan, subset, createRenderState(), partial.horizon);
    expect(part.left.length).toBe(partial.horizon);
    expect(bytes(part.left, partial.horizon)).toBe(bytes(full.left, partial.horizon));
    expect(bytes(part.right, partial.horizon)).toBe(bytes(full.right, partial.horizon));
  });

  it('marks every voice pending, with horizon 0, when nothing is present', () => {
    const { events, endBar } = performance('42', 16);
    expect(events[0]!.bar).toBe(0);
    const partial = planRenderPartial(manifest, events, endBar, new Map());
    expect(partial.pending).toEqual(events.map((_, i) => i));
    expect(partial.horizon).toBe(0);
    expect(partial.plan.voices.every((v) => v.end === v.start)).toBe(true);
  });

  it('reports a provisional length of at least the realized bars', () => {
    const { events, endBar } = performance('42', 16);
    const partial = planRenderPartial(manifest, events, endBar, stemsUsedBy(events, 0));
    expect(partial.final).toBe(false);
    expect(partial.plan.totalFrames).toBeGreaterThanOrEqual(barFrame(manifest, endBar));
    expect(partial.plan.totalFrames).toBeLessThanOrEqual(
      planRender(manifest, events, endBar, stems).totalFrames,
    );
  });

  it('planRender still names the first missing stem', () => {
    const { events, endBar } = performance('42', 16);
    expect(() => planRender(manifest, events, endBar, new Map())).toThrow(
      `Missing stem ${events[0]!.clipHash}`,
    );
  });
});
