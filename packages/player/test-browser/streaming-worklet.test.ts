import { planRender, planRenderPartial, realizeForRender, type Stem } from '@spite-store/engine';
import { describe, expect, it } from 'vitest';
import golden42 from '../../../fixtures/golden/placeholder.float32.42.json';
import { EngineNode } from '../src/audio.js';
import { placeholder, placeholderStems, sha256Hex, workletUrl } from './helpers.js';

// Delivering stems in the middle of an offline render needs OfflineAudioContext.suspend(), which
// Firefox doesn't implement. The same hold-and-resume logic is checked frame for frame in Node
// (packages/player/test/mixer.test.ts); this test adds the real worklet where the browser allows.
const canSuspend = 'suspend' in OfflineAudioContext.prototype;

describe('worklet output while stems arrive', () => {
  it.skipIf(!canSuspend)(
    'matches the float32 golden with the held frames removed (needs offline suspend; not in Firefox)',
    async () => {
      const { events, endBar } = realizeForRender(placeholder, '42', { durationBars: 16 });
      const all = await placeholderStems();
      const total = planRender(placeholder, events, endBar, all).totalFrames;
      const bar0 = new Map<string, Stem>();
      for (const e of events) if (e.bar === 0) bar0.set(e.clipHash, all.get(e.clipHash)!);
      const partial = planRenderPartial(placeholder, events, endBar, bar0);
      expect(partial.final).toBe(false);
      const horizon = partial.horizon;

      const HOLD = 48_000; // the worklet holds for about a second of output
      const context = new OfflineAudioContext(2, total + HOLD + 4096, 48_000);
      const engine = await EngineNode.create(context, workletUrl);
      engine.node.connect(context.destination);
      await engine.load(partial, bar0, { transfer: false, late: 'wait' });
      const started = new Promise<void>((resolve) => {
        engine.onPosition = (_frame, playing) => playing && resolve();
      });
      engine.play();
      await started;

      let held = -1;
      engine.onWaiting = (frame) => (held = frame);
      const resumed = new Promise<void>((resolve) => (engine.onPlaying = () => resolve()));
      const suspendAt = (horizon + HOLD) / 48_000;
      const delivered = context.suspend(suspendAt).then(async () => {
        engine.update(planRenderPartial(placeholder, events, endBar, all), all, {
          transfer: false,
        });
        await resumed; // the worklet has the stems before rendering goes on
        await context.resume();
      });
      const buffer = await context.startRendering();
      await delivered;
      expect(held).toBe(horizon);

      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      // Rendering resumed at the suspend point, rounded to a render quantum by the browser.
      const resumeCandidates = [-256, -128, 0, 128, 256].map(
        (d) => Math.round(suspendAt * 48_000) + d,
      );
      const hashes = await Promise.all(
        resumeCandidates.map((resume) => {
          const out = new Float32Array(total * 2);
          for (let f = 0; f < total; f++) {
            const src = f < horizon ? f : f + (resume - horizon);
            out[2 * f] = left[src]!;
            out[2 * f + 1] = right[src]!;
          }
          return sha256Hex(out);
        }),
      );
      expect(hashes).toContain(golden42.float32Sha256);
      // Everything output while held is silence.
      const resume = resumeCandidates[hashes.indexOf(golden42.float32Sha256)]!;
      for (let f = horizon; f < resume; f++) {
        if (left[f] !== 0 || right[f] !== 0) throw new Error(`sound while held at frame ${f}`);
      }
    },
  );
});
