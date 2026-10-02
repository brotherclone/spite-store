import { barFrame } from '@spite-store/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import golden0 from '../../../fixtures/golden/placeholder.float32.0.json';
import golden42 from '../../../fixtures/golden/placeholder.float32.42.json';
import goldenSpite from '../../../fixtures/golden/placeholder.float32.spite-store.json';
import {
  placeholder,
  placeholderStems,
  planFor,
  renderThroughWorklet,
  sha256Hex,
} from './helpers.js';

const goldens = [golden0, golden42, goldenSpite];

describe('worklet output equals the float32 goldens', () => {
  let stems: Awaited<ReturnType<typeof placeholderStems>>;
  const renders = new Map<string | number, Float32Array>();

  beforeAll(async () => {
    stems = await placeholderStems();
  });

  it.each(goldens.map((g) => [JSON.stringify(g.seed), g] as const))(
    'seed %s',
    async (_, golden) => {
      const plan = planFor(golden.seed, golden.durationBars, stems);
      expect(plan.totalFrames).toBe(golden.frames);
      const out = await renderThroughWorklet(plan, stems);
      renders.set(golden.seed, out);
      expect(await sha256Hex(out)).toBe(golden.float32Sha256);
    },
  );

  it('continues exactly from a seek to bar 8', async () => {
    const plan = planFor(42, 16, stems);
    const whole = renders.get(42) ?? (await renderThroughWorklet(plan, stems));
    const from = barFrame(placeholder, 8);
    const after = await renderThroughWorklet(plan, stems, from);
    const expected = whole.subarray(from * 2);
    expect(after.length).toBe(expected.length);
    let first = -1;
    for (let i = 0; i < after.length && first < 0; i++) if (after[i] !== expected[i]) first = i;
    expect(first, 'first differing sample after the seek').toBe(-1);
  });
});
