import {
  createRenderState,
  renderBlockInto,
  type RenderPlan,
  type RenderState,
  type Stem,
} from '@spite-store/engine';
import {
  POSITION_INTERVAL,
  type FromWorklet,
  type LateMode,
  type PlanUpdate,
  type ToWorklet,
} from './protocol.js';

/**
 * The worklet's playback logic, free of AudioWorklet globals so it can be tested in Node. Every
 * sample it writes is the engine renderer's sample rounded to float32 by the Float32Array store.
 *
 * Stems may still be arriving. Under `wait`, output stops at the plan's horizon (silence, frame
 * held) until a later plan moves it on, so the frames played are exactly the full render's. Under
 * `skip`, time runs on: a pending voice whose start is reached is skipped for that occurrence, and
 * stays silent even if its stem arrives before the occurrence ends. Seeking clears the skips.
 * Allocates only when a message arrives, never per block in steady state.
 */
export class Mixer {
  private base: PlanUpdate | null = null;
  /** The base plan with skipped voices forced silent: what is actually rendered. */
  private plan: RenderPlan | null = null;
  private readonly skipped = new Set<number>();
  private readonly stems = new Map<string, Stem>();
  private state: RenderState = createRenderState();
  private mode: LateMode = 'wait';
  private blocked: number | null = null;
  private playing = false;
  private waiting = false;
  private sinceReport = 0;
  private left = new Float64Array(128);
  private right = new Float64Array(128);

  constructor(private readonly send: (message: FromWorklet) => void) {}

  /** The next frame to output. */
  get frame(): number {
    return this.state.frame;
  }

  private reportPosition(): void {
    this.sinceReport = 0;
    this.send({ type: 'position', frame: this.state.frame, playing: this.playing });
  }

  private applyPlan(update: PlanUpdate): void {
    this.base = update;
    this.plan =
      this.skipped.size === 0
        ? update.plan
        : {
            totalFrames: update.plan.totalFrames,
            voices: update.plan.voices.map((v, i) =>
              this.skipped.has(i) ? { ...v, end: v.start } : v,
            ),
          };
  }

  /** Under wait, whether the current frame can't be rendered yet. */
  private held(): boolean {
    return this.mode === 'wait' && !this.base!.final && this.state.frame >= this.base!.horizon;
  }

  /** Reports resuming if a hold has been released. */
  private release(): void {
    if (this.waiting && !(this.base && this.held())) {
      this.waiting = false;
      if (this.playing) this.send({ type: 'playing', frame: this.state.frame });
    }
  }

  receive(message: ToWorklet): void {
    switch (message.type) {
      case 'load':
        for (const s of message.stems)
          this.stems.set(s.hash, { frames: s.frames, channels: s.channels });
        this.skipped.clear();
        this.applyPlan(message);
        this.mode = message.late;
        this.blocked = null;
        this.state = createRenderState();
        this.playing = false;
        this.waiting = false;
        this.send({ type: 'ready' });
        break;
      case 'stems':
        for (const s of message.stems)
          this.stems.set(s.hash, { frames: s.frames, channels: s.channels });
        this.applyPlan(message);
        this.release();
        break;
      case 'late':
        this.mode = message.mode;
        this.release();
        break;
      case 'blocked':
        this.blocked =
          this.blocked === null ? message.frame : Math.min(this.blocked, message.frame);
        break;
      case 'play':
        if (!this.plan) return;
        if (this.base!.final && this.state.frame >= this.plan.totalFrames)
          this.state = createRenderState();
        this.playing = true;
        this.reportPosition();
        break;
      case 'pause':
        this.playing = false;
        this.waiting = false;
        this.reportPosition();
        break;
      case 'seek': {
        const total = this.plan?.totalFrames ?? 0;
        const frame = Math.max(0, Math.min(Math.floor(message.frame), total));
        this.state = { v: this.state.v, frame };
        if (this.skipped.size > 0 && this.base) {
          this.skipped.clear();
          this.applyPlan(this.base);
        }
        this.waiting = false;
        this.reportPosition();
        break;
      }
    }
  }

  /** Fills one output block. */
  process(outL: Float32Array, outR: Float32Array): void {
    const n = outL.length;
    if (!this.plan || !this.base || !this.playing) {
      outL.fill(0);
      outR.fill(0);
      return;
    }
    if (this.left.length < n) {
      // Only if a future render quantum is larger than 128; never in steady state.
      this.left = new Float64Array(n);
      this.right = new Float64Array(n);
    }
    const from = this.state.frame;
    let stop = this.plan.totalFrames;
    if (this.blocked !== null) stop = Math.min(stop, this.blocked);
    if (this.mode === 'wait' && !this.base.final) stop = Math.min(stop, this.base.horizon);
    const frames = Math.max(0, Math.min(n, stop - from));

    if (this.mode === 'skip') {
      // A pending voice whose start falls before the end of this block is late: leave it out.
      // Pending voices are already silent in the plan, so only later plans need to know.
      // Pending indexes are ascending, so voices are visited in start order.
      const pending = this.base.pending;
      for (let k = 0; k < pending.length; k++) {
        const i = pending[k]!;
        const start = this.plan.voices[i]!.start;
        if (start >= from + frames) break;
        if (this.skipped.has(i)) continue;
        this.skipped.add(i);
        this.send({ type: 'skipped', voice: i });
      }
    }

    this.state = renderBlockInto(this.plan, this.stems, this.state, frames, this.left, this.right);
    const written = this.state.frame - from;
    for (let i = 0; i < written; i++) {
      outL[i] = this.left[i]!;
      outR[i] = this.right[i]!;
    }
    outL.fill(0, written);
    outR.fill(0, written);

    this.sinceReport += n;
    const frame = this.state.frame;
    if (this.blocked !== null && frame >= this.blocked) {
      this.playing = false;
      this.reportPosition();
      this.send({ type: 'stopped', frame });
    } else if (frame >= this.plan.totalFrames && (this.base.final || this.mode === 'skip')) {
      this.playing = false;
      this.reportPosition();
      this.send({ type: 'ended', frame });
    } else if (this.held()) {
      if (!this.waiting) {
        this.waiting = true;
        this.send({ type: 'waiting', frame });
        this.reportPosition();
      }
    } else if (this.sinceReport >= POSITION_INTERVAL) {
      this.reportPosition();
    }
  }
}
