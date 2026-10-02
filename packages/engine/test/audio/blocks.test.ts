import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createRenderState,
  encodeWav16,
  planRender,
  realizeForRender,
  renderAll,
  renderBlock,
  type Manifest,
  type RenderState,
} from '../../src/index.js';
import { loadExample } from '../helpers/manifests.js';
import { rampStems } from '../helpers/stems.js';

function renderInBlocks(m: Manifest, seed: number | string, size: number, roundTrip: boolean) {
  const { events, endBar } = realizeForRender(m, seed, { durationBars: 16 });
  const stems = rampStems(m);
  let plan = planRender(m, events, endBar, stems);
  let state: RenderState = createRenderState();
  const left = new Float64Array(plan.totalFrames);
  const right = new Float64Array(plan.totalFrames);
  while (state.frame < plan.totalFrames) {
    const block = renderBlock(plan, stems, state, size);
    left.set(block.left, state.frame);
    right.set(block.right, state.frame);
    state = roundTrip ? JSON.parse(JSON.stringify(block.state)) : block.state;
    if (roundTrip) plan = JSON.parse(JSON.stringify(plan));
  }
  return { left, right };
}

const wavHash = (left: ArrayLike<number>, right: ArrayLike<number>) =>
  createHash('sha256')
    .update(encodeWav16([left, right]))
    .digest('hex');

describe('block rendering', () => {
  const m = loadExample('minimal.json');

  it('gives identical samples for any block size and through JSON round trips', () => {
    const { events, endBar } = realizeForRender(m, 42, { durationBars: 16 });
    const stems = rampStems(m);
    const whole = renderAll(planRender(m, events, endBar, stems), stems);
    const small = renderInBlocks(m, 42, 128, false);
    const large = renderInBlocks(m, 42, 1000, true);
    const same = (a: Float64Array, b: Float64Array) =>
      a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;
    expect(whole.left.some((v) => v !== 0)).toBe(true);
    expect(same(small.left, whole.left) && same(small.right, whole.right)).toBe(true);
    expect(same(large.left, whole.left) && same(large.right, whole.right)).toBe(true);
  });

  it('hashes identically across repeated renders', () => {
    const hashes = new Set(
      Array.from({ length: 10 }, () => {
        const { events, endBar } = realizeForRender(m, 'spite', { durationBars: 16 });
        const stems = rampStems(m);
        const { left, right } = renderAll(planRender(m, events, endBar, stems), stems);
        return wavHash(left, right);
      }),
    );
    expect(hashes.size).toBe(1);
  });
});
