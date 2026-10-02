import type { Manifest } from '../manifest.js';

export const SAMPLE_RATE = 48000;
/** Length of the linear fade applied when a slot chokes its previous clip (10 ms). */
export const CHOKE_FRAMES = 480;

/** Round half up, using only exactly specified operations. */
export const roundHalfUp = (x: number): number => Math.floor(x + 0.5);

/**
 * Start frame of `bar`. Within a tempo entry `{ bar: s, bpm, meter: [beats, unit] }`, bar `b`
 * starts at `F(s) + round((b - s) * N / bpm)` with `N = beats * (4 / unit) * 60 * 48000`, an exact
 * integer. Rounding happens once per bar relative to its entry, so error never accumulates.
 */
export function barFrame(manifest: Manifest, bar: number): number {
  if (!Number.isSafeInteger(bar) || bar < 0) throw new RangeError(`Invalid bar ${String(bar)}`);
  const tempo = manifest.tempo;
  let entryFrame = 0;
  for (let i = 0; i < tempo.length; i++) {
    const entry = tempo[i]!;
    const next = tempo[i + 1];
    const n = entry.meter[0] * (4 / entry.meter[1]) * 60 * SAMPLE_RATE;
    if (next === undefined || bar < next.bar) {
      return entryFrame + roundHalfUp(((bar - entry.bar) * n) / entry.bpm);
    }
    entryFrame += roundHalfUp(((next.bar - entry.bar) * n) / entry.bpm);
  }
  throw new Error('Manifest has an empty tempo map');
}
