import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeWav,
  planRender,
  planRenderPartial,
  realizeForRender,
  renderAll,
  synthesizeStemWav,
  type ClipRecipe,
  type Manifest,
  type RenderPlan,
  type Stem,
} from '@spite-store/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { Mixer } from '../src/mixer.js';
import type { FromWorklet, LateMode, StemTransfer } from '../src/protocol.js';

const repo = join(import.meta.dirname, '../../..');
const read = (file: string) => JSON.parse(readFileSync(join(repo, file), 'utf8'));
const manifest = read('pieces/placeholder/manifest.json') as Manifest;
const golden42 = read('fixtures/golden/placeholder.float32.42.json') as { float32Sha256: string };
const BLOCK = 128;

let stems: Map<string, Stem>;
beforeAll(() => {
  const recipes = read('pieces/placeholder/recipes.json') as Record<string, ClipRecipe>;
  stems = new Map();
  for (const [id, recipe] of Object.entries(recipes)) {
    const hash = manifest.clips[id]!.hash;
    stems.set(hash, decodeWav(synthesizeStemWav(recipe, id), hash));
  }
});

const { events, endBar } = realizeForRender(manifest, '42', { durationBars: 16 });
/** The stems seed 42 uses, in order of first use. */
const order = [...new Set(events.map((e) => e.clipHash))];
const firstStart = (hash: string, plan: RenderPlan) =>
  plan.voices.find((v) => v.clipHash === hash)!.start;

const subset = (hashes: Iterable<string>) => new Map([...hashes].map((h) => [h, stems.get(h)!]));
const transfer = (hashes: Iterable<string>): StemTransfer[] =>
  [...hashes].map((h) => ({
    hash: h,
    frames: stems.get(h)!.frames,
    channels: stems.get(h)!.channels,
  }));
const update = (present: Set<string>) =>
  planRenderPartial(manifest, events, endBar, subset(present));

/** Interleaved float32 sha256, as the golden snapshots hash it. */
function float32Sha(left: ArrayLike<number>, right: ArrayLike<number>, frames: number): string {
  const out = new Float32Array(frames * 2);
  for (let f = 0; f < frames; f++) {
    out[2 * f] = left[f]!;
    out[2 * f + 1] = right[f]!;
  }
  return createHash('sha256').update(new Uint8Array(out.buffer)).digest('hex');
}

/**
 * Drives a Mixer block by block, delivering stems when the test says so. Collects only the frames
 * the mixer actually played (held output is left out), and every message it sent.
 */
class Harness {
  readonly messages: FromWorklet[] = [];
  readonly mixer = new Mixer((m) => this.messages.push(m));
  readonly present = new Set<string>();
  readonly left: number[] = [];
  readonly right: number[] = [];
  /** Every output sample, held silence included. */
  readonly raw: number[] = [];
  blocks = 0;

  constructor(initial: Iterable<string>, late: LateMode = 'wait') {
    for (const h of initial) this.present.add(h);
    this.mixer.receive({
      type: 'load',
      ...update(this.present),
      late,
      stems: transfer(this.present),
    });
    this.mixer.receive({ type: 'play' });
  }

  deliver(hashes: Iterable<string>) {
    const fresh = [...hashes].filter((h) => !this.present.has(h));
    for (const h of fresh) this.present.add(h);
    this.mixer.receive({ type: 'stems', ...update(this.present), stems: transfer(fresh) });
  }

  step() {
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    const from = this.mixer.frame;
    this.mixer.process(l, r);
    const played = this.mixer.frame - from;
    for (let i = 0; i < played; i++) {
      this.left.push(l[i]!);
      this.right.push(r[i]!);
    }
    for (let i = 0; i < BLOCK; i++) this.raw.push(l[i]!);
    this.blocks++;
    return played;
  }

  /** Steps until `done()` or the mixer stops playing, at most `limit` blocks. */
  runUntil(done: () => boolean, limit = 20_000) {
    for (let i = 0; i < limit && !done(); i++) this.step();
  }

  ended = () => this.messages.some((m) => m.type === 'ended' || m.type === 'stopped');
  types = () => this.messages.map((m) => m.type).filter((t) => t !== 'position');
  sha = () => float32Sha(this.left, this.right, this.left.length);
}

describe('Mixer under wait', () => {
  it('reproduces the float32 golden with held blocks removed, stems arriving late', () => {
    const h = new Harness(order.slice(0, 2));
    // Deliver each remaining stem only after the mixer has held for it for 10 blocks.
    let next = 2;
    let heldFor = 0;
    h.runUntil(() => {
      if (h.ended()) return true;
      if (next < order.length && h.types().at(-1) === 'waiting') heldFor++;
      if (heldFor >= 10) {
        h.deliver([order[next++]!]);
        heldFor = 0;
      }
      return false;
    });
    const full = planRender(manifest, events, endBar, stems);
    expect(h.left.length).toBe(full.totalFrames);
    expect(h.sha()).toBe(golden42.float32Sha256);
    expect(h.types().filter((t) => t === 'waiting').length).toBeGreaterThan(0);
    expect(h.types().filter((t) => t === 'waiting').length).toBe(
      h.types().filter((t) => t === 'playing').length,
    );
    expect(h.types().at(-1)).toBe('ended');
  });

  it('holds at the horizon frame and resumes from exactly it', () => {
    const h = new Harness(order.slice(0, 1));
    const horizon = update(h.present).horizon;
    h.runUntil(() => h.types().includes('waiting'));
    expect(h.mixer.frame).toBe(horizon);
    for (let i = 0; i < 5; i++) expect(h.step()).toBe(0);
    h.deliver(order);
    expect(h.messages.at(-1)).toEqual({ type: 'playing', frame: horizon });
    expect(h.step()).toBe(BLOCK);
  });

  it('never ends while stems are still loading', () => {
    const h = new Harness(order.slice(0, 1));
    h.runUntil(() => false, 2_000);
    expect(h.types()).not.toContain('ended');
  });
});

describe('Mixer under skip', () => {
  it('with no late stems plays exactly what wait plays', () => {
    const run = (late: LateMode) => {
      const h = new Harness(order.slice(0, 1), late);
      const full = planRender(manifest, events, endBar, stems);
      // Each stem arrives a block before the frame where it is first used.
      h.runUntil(() => {
        for (const hash of order) {
          if (!h.present.has(hash) && firstStart(hash, full) <= h.mixer.frame + 2 * BLOCK)
            h.deliver([hash]);
        }
        return h.ended();
      });
      return h;
    };
    const wait = run('wait');
    const skip = run('skip');
    expect(skip.types()).not.toContain('skipped');
    expect(skip.sha()).toBe(wait.sha());
    expect(skip.sha()).toBe(golden42.float32Sha256);
  });

  it('leaves a late clip out for its whole occurrence, even if it arrives mid-occurrence', () => {
    const full = planRender(manifest, events, endBar, stems);
    const late = order[2]!;
    const lateVoice = full.voices.findIndex((v) => v.clipHash === late);
    const { start, end } = full.voices[lateVoice]!;
    const h = new Harness(
      order.filter((x) => x !== late),
      'skip',
    );
    // The late stem arrives halfway through its first occurrence.
    h.runUntil(() => {
      if (!h.present.has(late) && h.mixer.frame >= (start + end) / 2) h.deliver([late]);
      return h.ended();
    });
    const skipped = h.messages.filter((m) => m.type === 'skipped');
    expect(skipped).toEqual([{ type: 'skipped', voice: lateVoice }]);
    // Expected: the full plan with that occurrence silenced (its choke of the slot stays).
    const silenced: RenderPlan = {
      totalFrames: full.totalFrames,
      voices: full.voices.map((v, i) => (i === lateVoice ? { ...v, end: v.start } : v)),
    };
    const expected = renderAll(silenced, stems);
    expect(h.left.length).toBe(full.totalFrames);
    expect(h.sha()).toBe(float32Sha(expected.left, expected.right, full.totalFrames));
  });

  it('seeking clears the skips, so the clip plays when reached again', () => {
    const full = planRender(manifest, events, endBar, stems);
    const late = order[2]!;
    const start = firstStart(late, full);
    const h = new Harness(
      order.filter((x) => x !== late),
      'skip',
    );
    h.runUntil(() => h.types().includes('skipped'));
    h.deliver([late]);
    const seekTo = start - 10 * BLOCK;
    h.mixer.receive({ type: 'seek', frame: seekTo });
    h.left.length = 0;
    h.right.length = 0;
    h.runUntil(() => h.ended());
    expect(h.types().filter((t) => t === 'skipped')).toHaveLength(1);
    const expected = renderAll(full, stems);
    expect(h.sha()).toBe(
      float32Sha(
        expected.left.subarray(seekTo),
        expected.right.subarray(seekTo),
        full.totalFrames - seekTo,
      ),
    );
  });
});

describe('Mixer controls', () => {
  it('stops exactly at a blocked frame', () => {
    const h = new Harness(order);
    const blocked = 3 * 48_000 + 17;
    h.mixer.receive({ type: 'blocked', frame: blocked });
    h.runUntil(() => h.ended());
    expect(h.left.length).toBe(blocked);
    expect(h.messages.at(-1)).toEqual({ type: 'stopped', frame: blocked });
    expect(h.step()).toBe(0);
  });

  it('switching to skip mid-hold releases the hold', () => {
    const h = new Harness(order.slice(0, 1));
    h.runUntil(() => h.types().includes('waiting'));
    const held = h.mixer.frame;
    h.mixer.receive({ type: 'late', mode: 'skip' });
    expect(h.messages.at(-1)).toEqual({ type: 'playing', frame: held });
    expect(h.step()).toBe(BLOCK);
    expect(h.types()).toContain('skipped');
  });

  it('reuses its output buffers in steady state', () => {
    const h = new Harness(order);
    const internals = h.mixer as unknown as { left: Float64Array; right: Float64Array };
    const left = internals.left;
    const right = internals.right;
    for (let i = 0; i < 100; i++) h.step();
    expect(internals.left).toBe(left);
    expect(internals.right).toBe(right);
  });
});
