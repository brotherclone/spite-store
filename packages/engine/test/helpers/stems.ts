import type { Manifest, Stem } from '../../src/index.js';

/** Deterministic, non-constant stems with tails for every clip in a manifest. */
export function rampStems(m: Manifest): Map<string, Stem> {
  const stems = new Map<string, Stem>();
  Object.entries(m.clips).forEach(([, clip], k) => {
    const frames = clip.lengthBars * 96000 + 30000 + k * 7001;
    const l = new Float32Array(frames);
    const r = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      l[i] = ((i * (k + 3)) % 997) / 997 - 0.5;
      r[i] = ((i * (k + 5)) % 641) / 641 - 0.5;
    }
    stems.set(clip.hash, { frames, channels: [l, r] });
  });
  return stems;
}
