import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RENDER_FORMAT, planRender, realizeForRender, renderAll } from '../../src/index.js';
import { loadPlaceholder, placeholderStems, repoRoot, sha256 } from '../helpers/placeholder.js';

/** Interleaves L/R into a Float32Array: each double is rounded to float32 exactly once. */
export function float32Interleaved(left: Float64Array, right: Float64Array): Float32Array {
  const out = new Float32Array(left.length * 2);
  for (let f = 0; f < left.length; f++) {
    out[2 * f] = left[f]!;
    out[2 * f + 1] = right[f]!;
  }
  return out;
}

describe('float32 output snapshots', () => {
  const { manifest } = loadPlaceholder();
  const stems = placeholderStems();

  it.each(['0', '42', 'spite-store'])('placeholder.float32.%s.json matches', (name) => {
    const snapshot = JSON.parse(
      readFileSync(join(repoRoot, 'fixtures/golden', `placeholder.float32.${name}.json`), 'utf8'),
    ) as {
      seed: string | number;
      durationBars: number;
      renderFormat: number;
      frames: number;
      float32Sha256: string;
    };
    expect(snapshot.renderFormat).toBe(RENDER_FORMAT);
    const { events, endBar } = realizeForRender(manifest, snapshot.seed, {
      durationBars: snapshot.durationBars,
    });
    const plan = planRender(manifest, events, endBar, stems);
    const { left, right } = renderAll(plan, stems);
    expect(plan.totalFrames).toBe(snapshot.frames);
    const f32 = float32Interleaved(left, right);
    expect(
      sha256(new Uint8Array(f32.buffer)),
      `float32 drift for seed ${JSON.stringify(snapshot.seed)}`,
    ).toBe(snapshot.float32Sha256);
  });

  it('rounds each sample to float32 once', () => {
    const f32 = float32Interleaved(Float64Array.of(0.1), Float64Array.of(-1 / 3));
    expect(f32[0]).toBe(Math.fround(0.1));
    expect(f32[0]).not.toBe(0.1);
    expect(f32[1]).toBe(Math.fround(-1 / 3));
  });
});
