import type { RenderPlan, Stem } from '@spite-store/engine';
import { PROCESSOR_NAME, type FromWorklet, type StemTransfer, type ToWorklet } from './protocol.js';

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

  private constructor(readonly node: AudioWorkletNode) {
    node.port.onmessage = (event: MessageEvent<FromWorklet>) => {
      const m = event.data;
      if (m.type === 'ready') this.pendingReady?.();
      else if (m.type === 'position') this.onPosition(m.frame, m.playing);
      else if (m.type === 'ended') this.onEnded(m.frame);
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

  /** Sends a plan (and any stems the worklet lacks) and resolves once the worklet has it. */
  load(
    plan: RenderPlan,
    stems: ReadonlyMap<string, Stem>,
    { transfer = true } = {},
  ): Promise<void> {
    const outgoing: StemTransfer[] = [];
    const buffers: Transferable[] = [];
    for (const [hash, stem] of stems) {
      if (this.sent.has(hash)) continue;
      this.sent.add(hash);
      const channels = transfer ? stem.channels : stem.channels.map((c) => c.slice());
      outgoing.push({ hash, frames: stem.frames, channels });
      if (transfer) for (const c of channels) buffers.push(c.buffer);
    }
    const ready = new Promise<void>((resolve) => (this.pendingReady = resolve));
    this.post({ type: 'load', plan, stems: outgoing }, buffers);
    return ready;
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
