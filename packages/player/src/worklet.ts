import {
  createRenderState,
  renderBlockInto,
  type RenderPlan,
  type RenderState,
  type Stem,
} from '@spite-store/engine';
import { POSITION_INTERVAL, PROCESSOR_NAME, type FromWorklet, type ToWorklet } from './protocol.js';

/**
 * Mixes a render plan into the audio output. Every output sample is the engine renderer's sample
 * rounded to float32 by the Float32Array store; nothing else touches the signal here.
 */
class SpiteProcessor extends AudioWorkletProcessor {
  private plan: RenderPlan | null = null;
  private readonly stems = new Map<string, Stem>();
  private state: RenderState = createRenderState();
  private playing = false;
  private sinceReport = 0;
  private left = new Float64Array(128);
  private right = new Float64Array(128);

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ToWorklet>) => this.receive(event.data);
  }

  private send(message: FromWorklet): void {
    this.port.postMessage(message);
  }

  private reportPosition(): void {
    this.sinceReport = 0;
    this.send({ type: 'position', frame: this.state.frame, playing: this.playing });
  }

  private receive(message: ToWorklet): void {
    switch (message.type) {
      case 'load':
        for (const s of message.stems)
          this.stems.set(s.hash, { frames: s.frames, channels: s.channels });
        this.plan = message.plan;
        this.state = createRenderState();
        this.playing = false;
        this.send({ type: 'ready' });
        break;
      case 'play':
        if (!this.plan) return;
        if (this.state.frame >= this.plan.totalFrames) this.state = createRenderState();
        this.playing = true;
        this.reportPosition();
        break;
      case 'pause':
        this.playing = false;
        this.reportPosition();
        break;
      case 'seek': {
        const total = this.plan?.totalFrames ?? 0;
        const frame = Math.max(0, Math.min(Math.floor(message.frame), total));
        this.state = { v: this.state.v, frame };
        this.reportPosition();
        break;
      }
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]!;
    const outL = out[0]!;
    const outR = out[1] ?? outL;
    const n = outL.length;
    if (!this.plan || !this.playing) {
      outL.fill(0);
      outR.fill(0);
      return true;
    }
    if (this.left.length < n) {
      // Only if a future render quantum is larger than 128; never in steady state.
      this.left = new Float64Array(n);
      this.right = new Float64Array(n);
    }
    const from = this.state.frame;
    this.state = renderBlockInto(this.plan, this.stems, this.state, n, this.left, this.right);
    const written = this.state.frame - from;
    for (let i = 0; i < written; i++) {
      outL[i] = this.left[i]!;
      outR[i] = this.right[i]!;
    }
    outL.fill(0, written);
    outR.fill(0, written);

    this.sinceReport += n;
    if (this.state.frame >= this.plan.totalFrames) {
      this.playing = false;
      this.reportPosition();
      this.send({ type: 'ended', frame: this.state.frame });
    } else if (this.sinceReport >= POSITION_INTERVAL) {
      this.reportPosition();
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, SpiteProcessor);
