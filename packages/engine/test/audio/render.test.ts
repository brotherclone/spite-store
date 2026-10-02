import { describe, expect, it } from 'vitest';
import {
  CHOKE_FRAMES,
  barFrame,
  planRender,
  realizeForRender,
  renderAll,
  type Stem,
  type TraceEvent,
} from '../../src/index.js';
import { clips, hashOf, manifest } from '../helpers/manifests.js';

const BAR = 96000; // 120 bpm, 4/4 in the test manifest helper

/** A stem of `frames` frames with a constant value (mono unless `right` is given). */
function constantStem(frames: number, value: number, right?: number): Stem {
  const l = new Float32Array(frames).fill(value);
  return {
    frames,
    channels: right === undefined ? [l] : [l, new Float32Array(frames).fill(right)],
  };
}

const ev = (bar: number, slot: string, clip: string, gain = 1): TraceEvent => ({
  bar,
  beat: 0,
  slot,
  clipHash: hashOf(clip),
  gain,
});

const m = manifest({
  clips: clips({ a: 1, b: 1, long: 1 }),
  sections: [{ id: 's', lengthBars: 1, slots: [{ id: 'x', pool: [{ clip: 'a', weight: 1 }] }] }],
});

describe('mixing', () => {
  it('applies event gain', () => {
    const stems = new Map([[hashOf('a'), constantStem(BAR, 0.5)]]);
    const { left, right } = renderAll(planRender(m, [ev(0, 'x', 'a', 0.5)], 1, stems), stems);
    expect(left.length).toBe(BAR);
    expect(left.every((v) => v === 0.25) && right.every((v) => v === 0.25)).toBe(true);
  });

  it('renders silence where no clip sounds', () => {
    const stems = new Map([[hashOf('a'), constantStem(BAR, 0.5)]]);
    const plan = planRender(m, [ev(0, 'x', 'a'), ev(4, 'x', 'a')], 5, stems);
    const { left } = renderAll(plan, stems);
    expect(left.length).toBe(5 * BAR);
    expect(left.subarray(BAR, 4 * BAR).every((v) => v === 0)).toBe(true);
    expect(left[4 * BAR]).toBe(0.5);
  });

  it('sums overlapping clips and upmixes mono', () => {
    const stems = new Map([
      [hashOf('a'), constantStem(BAR, 0.25)],
      [hashOf('b'), constantStem(BAR, 0.5, -0.5)],
    ]);
    const { left, right } = renderAll(
      planRender(m, [ev(0, 'x', 'a'), ev(0, 'y', 'b')], 1, stems),
      stems,
    );
    expect(left[100]).toBe(0.75);
    expect(right[100]).toBe(-0.25);
    const mono = renderAll(planRender(m, [ev(0, 'x', 'a')], 1, stems), stems);
    expect(Array.from(mono.left)).toEqual(Array.from(mono.right));
  });
});

describe('tails and choke', () => {
  const stems = new Map([
    [hashOf('long'), constantStem(3 * BAR, 1)],
    [hashOf('a'), constantStem(BAR, 0)],
  ]);

  it('rings until the same slot starts its next clip, then fades over 480 frames', () => {
    const plan = planRender(m, [ev(0, 'drums', 'long'), ev(2, 'drums', 'a')], 3, stems);
    const { left } = renderAll(plan, stems);
    expect(left.subarray(0, 2 * BAR).every((v) => v === 1)).toBe(true);
    expect(left[2 * BAR]).toBe(1);
    expect(left[2 * BAR + CHOKE_FRAMES / 2]).toBe(0.5);
    expect(left[2 * BAR + CHOKE_FRAMES - 1]).toBe(1 / CHOKE_FRAMES);
    expect(left.subarray(2 * BAR + CHOKE_FRAMES).every((v) => v === 0)).toBe(true);
  });

  it('does not choke across different slots', () => {
    const plan = planRender(m, [ev(0, 'pad', 'long'), ev(1, 'drums', 'a')], 3, stems);
    expect(plan.voices[0]!.choke).toBeNull();
    expect(
      renderAll(plan, stems)
        .left.subarray(0, 3 * BAR)
        .every((v) => v === 1),
    ).toBe(true);
  });

  it('lets tails cross section boundaries when the next section has no event in that slot', () => {
    const sections = manifest({
      clips: clips({ long: 1, a: 1 }),
      sections: [
        {
          id: 'one',
          lengthBars: 1,
          slots: [{ id: 'pad', pool: [{ clip: 'long', weight: 1 }] }],
          next: [{ to: 'two', weight: 1 }],
        },
        { id: 'two', lengthBars: 2, slots: [{ id: 'drums', pool: [{ clip: 'a', weight: 1 }] }] },
      ],
    });
    const { events, endBar } = realizeForRender(sections, 0, { durationBars: 3 });
    const plan = planRender(sections, events, endBar, stems);
    const pad = plan.voices.find((v) => v.slot === 'pad')!;
    expect(pad.choke).toBeNull();
    expect(pad.end).toBe(3 * BAR);
    expect(renderAll(plan, stems).left[2 * BAR + 10]).toBe(1);
  });
});

describe('piece ending', () => {
  it('rings tails out past the last bar without fading', () => {
    const stems = new Map([[hashOf('long'), constantStem(BAR * 2.5, 1)]]);
    const plan = planRender(m, [ev(7, 'pad', 'long')], 8, stems);
    expect(plan.totalFrames).toBe(barFrame(m, 8) + 1.5 * BAR);
    const { left } = renderAll(plan, stems);
    expect(left[left.length - 1]).toBe(1);
  });

  it('keeps a silent ending up to the bar after the last realized bar', () => {
    const stems = new Map([[hashOf('a'), constantStem(BAR, 1)]]);
    const plan = planRender(m, [ev(2, 'x', 'a')], 8, stems);
    expect(plan.totalFrames).toBe(8 * BAR);
  });

  it('uses the bar where realization ended early', () => {
    const ending = manifest({
      clips: clips({ a: 1 }),
      sections: [
        { id: 's', lengthBars: 2, slots: [{ id: 'x', pool: [{ clip: 'a', weight: 1 }] }] },
      ],
    });
    expect(realizeForRender(ending, 0, { durationBars: 50 }).endBar).toBe(2);
  });

  it('fails clearly on a missing stem', () => {
    expect(() => planRender(m, [ev(0, 'x', 'a')], 1, new Map())).toThrow(hashOf('a'));
  });
});
