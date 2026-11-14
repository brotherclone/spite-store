import type { RenderPlan } from '@spite-store/engine';

/** Name the worklet registers its processor under. */
export const PROCESSOR_NAME = 'spite-player';
/** Frames between position reports from the worklet (~31 per second at 48 kHz). */
export const POSITION_INTERVAL = 1536;

/** What playback does at a clip whose stem is still loading: hold until it arrives, or leave it out. */
export type LateMode = 'wait' | 'skip';

export interface StemTransfer {
  hash: string;
  frames: number;
  channels: Float32Array[];
}

/**
 * A render plan as far as the stems loaded so far allow (see the engine's `planRenderPartial`):
 * pending voices are zero-length, and frames before `horizon` are exact.
 */
export interface PlanUpdate {
  plan: RenderPlan;
  /** Indexes of the voices whose stem hasn't arrived, ascending. */
  pending: number[];
  horizon: number;
  final: boolean;
}

/** Main thread -> worklet. Stems are cached by hash in the worklet across loads. */
export type ToWorklet =
  | ({ type: 'load'; stems: StemTransfer[]; late: LateMode } & PlanUpdate)
  | ({ type: 'stems'; stems: StemTransfer[] } & PlanUpdate)
  | { type: 'late'; mode: LateMode }
  /** A stem failed: never render this frame or later; stop on reaching it. */
  | { type: 'blocked'; frame: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; frame: number };

/** Worklet -> main thread. `frame` is the next frame the worklet will output. */
export type FromWorklet =
  | { type: 'ready' }
  | { type: 'position'; frame: number; playing: boolean }
  | { type: 'ended'; frame: number }
  /** Holding at `frame` for a stem still loading (wait mode). */
  | { type: 'waiting'; frame: number }
  /** Resumed from `frame` after holding. */
  | { type: 'playing'; frame: number }
  /** Voice `voice` of the plan was left out because its stem was late (skip mode). */
  | { type: 'skipped'; voice: number }
  /** Reached a blocked frame and stopped. */
  | { type: 'stopped'; frame: number };
