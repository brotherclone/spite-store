import type { RenderPlan } from '@spite-store/engine';

/** Name the worklet registers its processor under. */
export const PROCESSOR_NAME = 'spite-player';
/** Frames between position reports from the worklet (~31 per second at 48 kHz). */
export const POSITION_INTERVAL = 1536;

export interface StemTransfer {
  hash: string;
  frames: number;
  channels: Float32Array[];
}

/** Main thread -> worklet. Stems are cached by hash in the worklet across loads. */
export type ToWorklet =
  | { type: 'load'; plan: RenderPlan; stems: StemTransfer[] }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; frame: number };

/** Worklet -> main thread. `frame` is the next frame the worklet will output. */
export type FromWorklet =
  | { type: 'ready' }
  | { type: 'position'; frame: number; playing: boolean }
  | { type: 'ended'; frame: number };
