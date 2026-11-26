import {
  encodeWav16,
  planRender,
  realizeForRender,
  renderAll,
  type Manifest,
} from '@spite-store/engine';
import { loadStems, type StemProblem } from './stems.js';

export interface RenderedFloat {
  /** The render's channels, before any quantization. */
  left: Float64Array;
  right: Float64Array;
  frames: number;
  events: number;
}

export interface RenderedSeed {
  /** 16-bit stereo 48 kHz WAV bytes, exactly what `spite bounce` writes. */
  wav: Uint8Array;
  frames: number;
  events: number;
}

/**
 * Realizes and renders one seed with stems from `stemsDir`, returning the float channels, or every
 * missing or invalid stem the render would need (and renders nothing).
 */
export function renderSeed(
  manifest: Manifest,
  seed: string,
  bars: number,
  stemsDir: string,
): RenderedFloat | { problems: StemProblem[] } {
  const { events, endBar } = realizeForRender(manifest, seed, { durationBars: bars });
  const { stems, problems } = loadStems(
    manifest,
    events.map((e) => e.clipHash),
    stemsDir,
  );
  if (problems.length > 0) return { problems };
  const plan = planRender(manifest, events, endBar, stems);
  const { left, right } = renderAll(plan, stems);
  return { left, right, frames: plan.totalFrames, events: events.length };
}

/** `renderSeed`, encoded as the 16-bit WAV that `spite bounce` and `spite fallback` use. */
export function renderSeedWav(
  manifest: Manifest,
  seed: string,
  bars: number,
  stemsDir: string,
): RenderedSeed | { problems: StemProblem[] } {
  const rendered = renderSeed(manifest, seed, bars, stemsDir);
  if ('problems' in rendered) return rendered;
  const { left, right, frames, events } = rendered;
  return { wav: encodeWav16([left, right]), frames, events };
}
