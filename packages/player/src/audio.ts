import type { RenderPlan, Stem } from '@spite-store/engine';
import {
  PROCESSOR_NAME,
  type FromWorklet,
  type LateMode,
  type PlanUpdate,
  type StemTransfer,
  type ToWorklet,
} from './protocol.js';

/** A complete plan as a plan update: nothing pending. */
const complete = (plan: RenderPlan): PlanUpdate => ({
  plan,
  pending: [],
  horizon: plan.totalFrames,
  final: true,
});

const modules = new WeakMap<BaseAudioContext, Promise<void>>();

/** The worklet module URL, next to this file in `dist/`. */
export const defaultWorkletUrl = (): string => new URL('./worklet.js', import.meta.url).href;

/**
 * The worklet node and its message protocol. Stems are sent once per node and cached in the
 * worklet by hash. With `transfer`, their buffers move to the worklet (no copy).
 */
export class EngineNode {
  private readonly sent = new Set<string>();
  private pendingReady: (() => void) | null = null;
  onPosition: (frame: number, playing: boolean) => void = () => {};
  onEnded: (frame: number) => void = () => {};
  onWaiting: (frame: number) => void = () => {};
  onPlaying: (frame: number) => void = () => {};
  onSkipped: (voice: number) => void = () => {};
  onStopped: (frame: number) => void = () => {};

  private constructor(readonly node: AudioWorkletNode) {
    node.port.onmessage = (event: MessageEvent<FromWorklet>) => {
      const m = event.data;
      if (m.type === 'ready') this.pendingReady?.();
      else if (m.type === 'position') this.onPosition(m.frame, m.playing);
      else if (m.type === 'ended') this.onEnded(m.frame);
      else if (m.type === 'waiting') this.onWaiting(m.frame);
      else if (m.type === 'playing') this.onPlaying(m.frame);
      else if (m.type === 'skipped') this.onSkipped(m.voice);
      else if (m.type === 'stopped') this.onStopped(m.frame);
    };
  }

  static async create(
    context: BaseAudioContext,
    workletUrl = defaultWorkletUrl(),
  ): Promise<EngineNode> {
    if (!modules.has(context)) modules.set(context, context.audioWorklet.addModule(workletUrl));
    await modules.get(context);
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    return new EngineNode(node);
  }

  private post(message: ToWorklet, transfer: Transferable[] = []): void {
    this.node.port.postMessage(message, transfer);
  }

  /** Stems the worklet lacks, as transfers. With `transfer`, their buffers move (no copy). */
  private outgoing(
    stems: ReadonlyMap<string, Stem>,
    transfer: boolean,
  ): { outgoing: StemTransfer[]; buffers: Transferable[] } {
    const outgoing: StemTransfer[] = [];
    const buffers: Transferable[] = [];
    for (const [hash, stem] of stems) {
      if (this.sent.has(hash)) continue;
      this.sent.add(hash);
      const channels = transfer ? stem.channels : stem.channels.map((c) => c.slice());
      outgoing.push({ hash, frames: stem.frames, channels });
      if (transfer) for (const c of channels) buffers.push(c.buffer);
    }
    return { outgoing, buffers };
  }

  /**
   * Sends a plan (complete, or partial while stems are still arriving) and any stems the worklet
   * lacks, and resolves once the worklet has it.
   */
  load(
    plan: RenderPlan | PlanUpdate,
    stems: ReadonlyMap<string, Stem>,
    { transfer = true, late = 'wait' as LateMode } = {},
  ): Promise<void> {
    const update = 'voices' in plan ? complete(plan) : plan;
    const { outgoing, buffers } = this.outgoing(stems, transfer);
    const ready = new Promise<void>((resolve) => (this.pendingReady = resolve));
    this.post({ type: 'load', ...update, late, stems: outgoing }, buffers);
    return ready;
  }

  /** Sends a newer plan and the stems that arrived since the last one. */
  update(update: PlanUpdate, stems: ReadonlyMap<string, Stem>, { transfer = true } = {}): void {
    const { outgoing, buffers } = this.outgoing(stems, transfer);
    this.post({ type: 'stems', ...update, stems: outgoing }, buffers);
  }

  setLate(mode: LateMode): void {
    this.post({ type: 'late', mode });
  }

  /** Never render `frame` or later; the worklet stops (and reports it) on reaching it. */
  block(frame: number): void {
    this.post({ type: 'blocked', frame });
  }

  play(): void {
    this.post({ type: 'play' });
  }

  pause(): void {
    this.post({ type: 'pause' });
  }

  seek(frame: number): void {
    this.post({ type: 'seek', frame });
  }
}
