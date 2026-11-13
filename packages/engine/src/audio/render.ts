import type { Manifest } from '../manifest.js';
import type { Seed } from '../path.js';
import { advance, createState, type RealizeOptions, type TraceEvent } from '../realize.js';
import { CHOKE_FRAMES, barFrame } from './timing.js';
import { encodeWav16, type Stem } from './wav.js';

/** Bumped whenever a change alters rendered samples for an existing (manifest, seed, stems). */
export const RENDER_FORMAT = 1;
const RENDER_STATE_VERSION = 1;

/** One clip playing in the render. Frames are absolute; `choke` is null when nothing chokes it. */
export interface Voice {
  slot: string;
  clipHash: string;
  gain: number;
  start: number;
  choke: number | null;
  end: number;
}

/** Everything the mixer needs besides stem audio. Plain JSON. */
export interface RenderPlan {
  totalFrames: number;
  voices: Voice[];
}

export interface RenderState {
  v: number;
  frame: number;
}

export interface RenderBlock {
  left: Float64Array;
  right: Float64Array;
  state: RenderState;
}

/** Realizes a piece and also returns the bar after the last realized bar (the piece's end). */
export function realizeForRender(
  manifest: Manifest,
  seed: Seed,
  options: RealizeOptions,
): { events: TraceEvent[]; endBar: number } {
  const { events, state } = advance(
    manifest,
    createState(manifest, seed, options),
    options.durationBars,
  );
  return { events, endBar: state.bar };
}

/** A render plan made before every stem is present. */
export interface PartialPlan {
  /** Voices of missing stems have `end === start`, so they render nothing. */
  plan: RenderPlan;
  /** Indexes into `plan.voices` of the voices whose stem is missing, ascending. */
  pending: number[];
  /** Every frame before this one renders exactly as with every stem present. */
  horizon: number;
  /** Whether every stem is present: then `plan` is the full plan and its length is final. */
  final: boolean;
}

/**
 * Turns a trace into voices. Each clip sounds from its bar's start frame until its stem ends, or
 * until the same slot id starts its next event, after which it fades out over CHOKE_FRAMES. The
 * render covers every realized bar, then runs until the last tail ends.
 *
 * Stems may be missing: their voices are pending and zero-length. Voices are in start order, so
 * every voice starting before the first pending one is complete, and no later voice reaches an
 * earlier frame; frames before `horizon` are therefore exact. Until `final`, `totalFrames` is a
 * lower bound (the realized bars, or a known tail beyond them).
 */
export function planRenderPartial(
  manifest: Manifest,
  events: readonly TraceEvent[],
  endBar: number,
  stems: ReadonlyMap<string, Stem>,
): PartialPlan {
  const voices: Voice[] = [];
  const pending: number[] = [];
  const lastBySlot = new Map<string, Voice>();
  for (const event of events) {
    const stem = stems.get(event.clipHash);
    const start = barFrame(manifest, event.bar);
    const previous = lastBySlot.get(event.slot);
    if (previous) {
      previous.choke = start;
      previous.end = Math.min(previous.end, start + CHOKE_FRAMES);
    }
    if (!stem) pending.push(voices.length);
    const voice: Voice = {
      slot: event.slot,
      clipHash: event.clipHash,
      gain: event.gain,
      start,
      choke: null,
      end: stem ? start + stem.frames : start,
    };
    voices.push(voice);
    lastBySlot.set(event.slot, voice);
  }
  let totalFrames = barFrame(manifest, endBar);
  for (const v of voices) if (v.end > totalFrames) totalFrames = v.end;
  const plan = { totalFrames, voices };
  const horizon = pending.length > 0 ? voices[pending[0]!]!.start : totalFrames;
  return { plan, pending, horizon, final: pending.length === 0 };
}

/** The full render plan. Every stem the trace uses must be present. */
export function planRender(
  manifest: Manifest,
  events: readonly TraceEvent[],
  endBar: number,
  stems: ReadonlyMap<string, Stem>,
): RenderPlan {
  const partial = planRenderPartial(manifest, events, endBar, stems);
  if (!partial.final) {
    throw new Error(`Missing stem ${partial.plan.voices[partial.pending[0]!]!.clipHash}`);
  }
  return partial.plan;
}

export function createRenderState(): RenderState {
  return { v: RENDER_STATE_VERSION, frame: 0 };
}

/**
 * Renders up to `frames` frames from `state.frame` into caller-owned buffers (which must hold at
 * least `frames` values; only the first `length` are written) and returns the new state. Each
 * output frame depends only on its absolute position, and voices are summed in plan order in
 * doubles, so any block size gives identical samples. Allocates nothing.
 */
export function renderBlockInto(
  plan: RenderPlan,
  stems: ReadonlyMap<string, Stem>,
  state: RenderState,
  frames: number,
  left: Float64Array,
  right: Float64Array,
): RenderState {
  if (state.v !== RENDER_STATE_VERSION)
    throw new Error(`Unsupported render state version ${String(state.v)}`);
  if (!Number.isSafeInteger(frames) || frames < 0)
    throw new RangeError(`Invalid block size ${String(frames)}`);
  const from = state.frame;
  const to = Math.min(from + frames, plan.totalFrames);
  const length = Math.max(0, to - from);
  if (left.length < length || right.length < length)
    throw new RangeError(`Output buffers hold fewer than ${length} frames`);
  left.fill(0, 0, length);
  right.fill(0, 0, length);

  for (const voice of plan.voices) {
    // Voices are in trace order, so start frames never decrease: nothing later can overlap.
    if (voice.start >= to) break;
    const a = Math.max(from, voice.start);
    const b = Math.min(to, voice.end);
    if (a >= b) continue;
    const stem = stems.get(voice.clipHash);
    if (!stem) throw new Error(`Missing stem ${voice.clipHash}`);
    const l = stem.channels[0]!;
    const r = stem.channels[1] ?? l;
    for (let f = a; f < b; f++) {
      const i = f - voice.start;
      const fade =
        voice.choke === null || f < voice.choke
          ? 1
          : (voice.choke + CHOKE_FRAMES - f) / CHOKE_FRAMES;
      const g = voice.gain * fade;
      const j = f - from;
      left[j] = left[j]! + l[i]! * g;
      right[j] = right[j]! + r[i]! * g;
    }
  }
  return { v: RENDER_STATE_VERSION, frame: from + length };
}

/** Like `renderBlockInto`, but allocates and returns exactly-sized buffers. */
export function renderBlock(
  plan: RenderPlan,
  stems: ReadonlyMap<string, Stem>,
  state: RenderState,
  frames: number,
): RenderBlock {
  const length = Math.max(
    0,
    Math.min(state.frame + Math.max(0, frames), plan.totalFrames) - state.frame,
  );
  const left = new Float64Array(length);
  const right = new Float64Array(length);
  const next = renderBlockInto(plan, stems, state, frames, left, right);
  return { left, right, state: next };
}

/** Renders a whole plan in one pass. */
export function renderAll(
  plan: RenderPlan,
  stems: ReadonlyMap<string, Stem>,
): { left: Float64Array; right: Float64Array } {
  const { left, right } = renderBlock(plan, stems, createRenderState(), plan.totalFrames);
  return { left, right };
}

/** Realizes, plans, renders and encodes a piece as a 16-bit stereo WAV file. */
export function renderWav(
  manifest: Manifest,
  seed: Seed,
  options: RealizeOptions,
  stems: ReadonlyMap<string, Stem>,
): { wav: Uint8Array; frames: number; endBar: number; events: TraceEvent[] } {
  const { events, endBar } = realizeForRender(manifest, seed, options);
  const plan = planRender(manifest, events, endBar, stems);
  const { left, right } = renderAll(plan, stems);
  return { wav: encodeWav16([left, right]), frames: plan.totalFrames, endBar, events };
}
