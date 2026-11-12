import {
  SAMPLE_RATE,
  barFrame,
  checkPin,
  describePinMismatch,
  type Fallback,
  type Manifest,
  type PinMismatch,
  type Stem,
} from '@spite-store/engine';
import { EngineNode, defaultWorkletUrl } from './audio.js';
import { Lanes } from './lanes.js';
import { LoadError, loadManifest, loadPerformance, sha256Hex, type Performance } from './loader.js';
import { randomSeed } from './seed.js';

const FADE_SECONDS = 0.01;

const template = `
<style>
  :host { display: block; font: 14px system-ui, sans-serif; color: var(--spite-ink, #222); }
  [part='controls'] { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  [part='controls'] input { font: inherit; width: 9em; }
  [part='bars'] { width: 4.5em !important; }
  [part='scrub'] { display: block; width: 100%; margin: 8px 0 4px; accent-color: var(--spite-accent, #d6336c); }
  [part='time'] { font-variant-numeric: tabular-nums; margin-left: auto; }
  [part='lanes'] { display: block; width: 100%; height: 40px; cursor: pointer; }
  [part='status'] { white-space: pre-wrap; font-size: 12px; min-height: 1.2em; margin-top: 4px; }
  [part='status'].error { color: var(--spite-error, #c92a2a); }
</style>
<div part="controls">
  <button part="play" type="button" disabled>Play</button>
  <label>Seed <input part="seed" type="text" spellcheck="false" autocomplete="off" /></label>
  <button part="reroll" type="button">Reroll</button>
  <label>Bars <input part="bars" type="number" min="1" step="1" /></label>
  <button part="copy" type="button">Copy link</button>
  <span part="time">0:00 / 0:00</span>
</div>
<input part="scrub" type="range" min="0" max="0" step="1" value="0" aria-label="Position" disabled />
<canvas part="lanes"></canvas>
<div part="status" role="status"></div>
`;

/** Why the player is playing the fixed recording instead of the generative performance. */
export type FallbackReason = 'forced' | 'engine' | 'unsupported' | 'stems' | 'worklet';

const REASON_TEXT: Record<Exclude<FallbackReason, 'engine'>, string> = {
  forced: 'the fixed recording was requested',
  unsupported: "this browser can't play the generative version",
  stems: "some stems couldn't be loaded",
  worklet: "the audio engine couldn't start",
};

/** The status reason for a piece pinned to other engine formats, by direction. */
const engineReasonText = (mismatches: readonly PinMismatch[]): string => {
  const made = new Set(mismatches.map((m) => m.made));
  const which = made.size > 1 ? 'a different' : made.has('older') ? 'an earlier' : 'a later';
  return `it was made with ${which} version of the player`;
};

/** Whether this page can run the generative player: an AudioWorklet and verified stem loads. */
const generativeSupported = (): boolean =>
  typeof AudioWorkletNode !== 'undefined' &&
  globalThis.isSecureContext === true &&
  globalThis.crypto?.subtle !== undefined;

const clock = (frames: number): string => {
  const s = Math.floor(frames / SAMPLE_RATE);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * `<spite-player src stems seed bars fallback>`: plays a finite performance (manifest, seed, bars)
 * with the engine renderer in an AudioWorklet, and draws its structure as lanes. When that can't
 * work and the manifest has a fallback recording, it plays that fixed recording instead.
 */
export class SpitePlayer extends HTMLElement {
  static observedAttributes = ['src', 'stems', 'seed', 'bars', 'fallback'];

  /** For tests and advanced embeds: replaces `fetch` for manifest and stem requests. */
  fetchImpl: typeof fetch = (...args) => fetch(...args);
  /** Worklet module URL; defaults to `worklet.js` next to this module. */
  workletUrl = defaultWorkletUrl();

  private readonly root: ShadowRoot;
  private readonly ui: {
    play: HTMLButtonElement;
    seed: HTMLInputElement;
    reroll: HTMLButtonElement;
    bars: HTMLInputElement;
    copy: HTMLButtonElement;
    time: HTMLElement;
    scrub: HTMLInputElement;
    lanes: HTMLCanvasElement;
    status: HTMLElement;
  };
  private readonly lanes: Lanes;
  private readonly cache = new Map<string, Stem>();
  private perf: Performance | null = null;
  private loadToken = 0;
  private loadScheduled = false;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private engine: EngineNode | null = null;
  private engineLoaded: Performance | null = null;
  private playing = false;
  private lastFrame = 0;
  private lastTime = 0;
  private animation = 0;
  /** Set while playing the fixed recording; null in generative mode. */
  private fallback: { manifest: Manifest; recording: Fallback; reason: FallbackReason } | null =
    null;
  private media: HTMLAudioElement | null = null;
  private mediaUrl: string | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = template;
    const q = <T extends Element>(part: string) => this.root.querySelector<T>(`[part='${part}']`)!;
    this.ui = {
      play: q('play'),
      seed: q('seed'),
      reroll: q('reroll'),
      bars: q('bars'),
      copy: q('copy'),
      time: q('time'),
      scrub: q('scrub'),
      lanes: q('lanes'),
      status: q('status'),
    };
    this.lanes = new Lanes(this.ui.lanes, this);
    this.lanes.onSeek = (frame) => void this.seek(frame);
    this.ui.play.addEventListener('click', () => void (this.playing ? this.pause() : this.play()));
    this.ui.reroll.addEventListener('click', () => this.changePerformance(randomSeed(), this.bars));
    this.ui.seed.addEventListener('change', () => {
      const seed = this.ui.seed.value.trim();
      if (seed) this.changePerformance(seed, this.bars);
    });
    this.ui.bars.addEventListener('change', () =>
      this.changePerformance(this.seed ?? randomSeed(), Number(this.ui.bars.value)),
    );
    this.ui.copy.addEventListener('click', () => void this.copyLink());
    this.ui.scrub.addEventListener('input', () => void this.seek(Number(this.ui.scrub.value)));
  }

  connectedCallback(): void {
    if (!this.hasAttribute('seed')) this.changePerformance(randomSeed(), this.bars);
    this.scheduleLoad();
  }

  disconnectedCallback(): void {
    void this.pause();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue !== newValue && this.isConnected) this.scheduleLoad();
  }

  get seed(): string | null {
    return this.getAttribute('seed');
  }

  /** The length in bars, or NaN when the `bars` attribute is invalid. */
  get bars(): number {
    const raw = this.getAttribute('bars');
    if (raw === null) return 64;
    return /^\d+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : NaN;
  }

  /** The loaded performance (trace, visits, plan), or null while loading or after an error. */
  get performance(): Performance | null {
    return this.perf;
  }

  /** Why the fixed recording is playing, or null when the performance is generative. */
  get fallbackReason(): FallbackReason | null {
    return this.fallback?.reason ?? null;
  }

  /** Current position in frames (48 kHz, also for the fixed recording). */
  get position(): number {
    if (this.fallback) {
      return this.media
        ? Math.min(this.totalFrames, Math.round(this.media.currentTime * SAMPLE_RATE))
        : 0;
    }
    if (!this.playing || !this.context) return this.lastFrame;
    const total = this.perf?.plan.totalFrames ?? 0;
    return Math.min(
      total,
      this.lastFrame + Math.round((this.context.currentTime - this.lastTime) * SAMPLE_RATE),
    );
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Length of what is loaded, in frames: the render, or the fixed recording once its length is known. */
  private get totalFrames(): number {
    if (this.fallback) {
      const d = this.media?.duration;
      return d !== undefined && Number.isFinite(d) ? Math.round(d * SAMPLE_RATE) : 0;
    }
    return this.perf?.plan.totalFrames ?? 0;
  }

  /** Sets seed and bars from the UI or a random choice, and announces it. */
  private changePerformance(seed: string, bars: number): void {
    this.setAttribute('seed', seed);
    if (Number.isFinite(bars)) this.setAttribute('bars', String(bars));
    else this.setAttribute('bars', String(this.ui.bars.value));
    this.dispatchEvent(
      new CustomEvent('seedchange', {
        detail: { seed, bars: this.bars },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private scheduleLoad(): void {
    if (this.loadScheduled) return;
    this.loadScheduled = true;
    queueMicrotask(() => {
      this.loadScheduled = false;
      void this.load();
    });
  }

  private setStatus(text: string, error = false): void {
    this.ui.status.textContent = text;
    this.ui.status.classList.toggle('error', error);
  }

  private fail(messages: string[]): void {
    this.setStatus(messages.join('\n'), true);
    this.dispatchEvent(new CustomEvent('error', { detail: { messages } }));
  }

  private async load(): Promise<void> {
    const token = ++this.loadToken;
    await this.stop();
    this.leaveFallback();
    this.perf = null;
    this.lanes.setPerformance(null);
    this.ui.play.disabled = true;
    this.ui.scrub.disabled = true;
    const seed = this.seed;
    const bars = this.bars;
    this.ui.seed.value = seed ?? '';
    this.ui.bars.value = this.getAttribute('bars') ?? '64';
    const src = this.getAttribute('src');
    if (!src) return this.fail(['missing src attribute (the manifest URL)']);
    if (!Number.isFinite(bars))
      return this.fail([
        `invalid bars attribute "${this.getAttribute('bars')}": expected a positive integer`,
      ]);
    if (seed === null) return;
    this.setStatus('Loading…');
    try {
      const manifest = await loadManifest(new URL(src, document.baseURI).href, this.fetchImpl);
      if (token !== this.loadToken) return;
      if (this.hasAttribute('fallback')) {
        if (!manifest.fallback)
          return this.fail([`${manifest.title} has no fallback recording (fallback attribute)`]);
        return await this.enterFallback(manifest, 'forced', token);
      }
      // A piece pinned to other engine formats would play a different performance from the one
      // its seed link names, so it is never played generatively here.
      const mismatches = checkPin(manifest);
      if (mismatches.length > 0) {
        const lines = mismatches.map(describePinMismatch);
        if (!manifest.fallback) {
          return this.fail([`${manifest.title} can't be played by this player:`, ...lines]);
        }
        return await this.enterFallback(
          manifest,
          'engine',
          token,
          lines,
          engineReasonText(mismatches),
        );
      }
      if (manifest.fallback && !generativeSupported()) {
        return await this.enterFallback(manifest, 'unsupported', token);
      }
      let perf: Performance;
      try {
        perf = await loadPerformance({
          manifest,
          seed,
          bars,
          stemsBase: this.stemsBase,
          cache: this.cache,
          fetch: this.fetchImpl,
          onProgress: (loaded, total) => {
            if (token === this.loadToken) this.setStatus(`Loading stems ${loaded} / ${total}`);
          },
        });
      } catch (error) {
        if (!(error instanceof LoadError) || !manifest.fallback) throw error;
        if (token !== this.loadToken) return;
        this.dispatchEvent(new CustomEvent('error', { detail: { messages: error.messages } }));
        return await this.enterFallback(manifest, 'stems', token, error.messages);
      }
      if (token !== this.loadToken) return;
      this.perf = perf;
      this.lastFrame = 0;
      this.lanes.setPerformance(perf);
      this.ui.scrub.max = String(perf.plan.totalFrames);
      this.ui.scrub.value = '0';
      this.ui.scrub.disabled = false;
      this.ui.play.disabled = false;
      this.updateTime(0);
      const loaded = [...perf.stems.keys()].length;
      this.setStatus(
        `${manifest.title} · ${perf.events.length} events · stems ${loaded} / ${loaded}`,
      );
      this.dispatchEvent(new CustomEvent('ready', { detail: { seed, bars } }));
    } catch (error) {
      if (token !== this.loadToken) return;
      this.fail(error instanceof LoadError ? error.messages : [String(error)]);
    }
  }

  private get stemsBase(): string {
    const base = new URL(this.getAttribute('stems') ?? 'stems/', document.baseURI).href;
    return base.endsWith('/') ? base : `${base}/`;
  }

  /**
   * Switches to the manifest's fixed recording: fetches and verifies it, disables the seed
   * controls, hides the lanes, and announces `fallback`, then `ready` once it can play.
   */
  private async enterFallback(
    manifest: Manifest,
    reason: FallbackReason,
    token: number,
    details: readonly string[] = [],
    reasonText = REASON_TEXT[reason as Exclude<FallbackReason, 'engine'>],
  ): Promise<void> {
    const recording = manifest.fallback!;
    this.perf = null;
    this.lanes.setPerformance(null);
    this.fallback = { manifest, recording, reason };
    this.lastFrame = 0;
    this.ui.play.disabled = true;
    this.ui.scrub.disabled = true;
    this.ui.scrub.value = '0';
    this.ui.seed.value = recording.seed;
    this.ui.bars.value = String(recording.bars);
    for (const control of [this.ui.seed, this.ui.reroll, this.ui.bars]) control.disabled = true;
    this.ui.lanes.hidden = true;
    this.updateTime(0);
    this.setStatus('Loading the fixed recording…');
    this.dispatchEvent(
      new CustomEvent('fallback', {
        detail: { reason, seed: recording.seed, bars: recording.bars },
      }),
    );

    const hex = recording.hash.slice('sha256:'.length);
    const url = new URL(`${hex}.mp3`, this.stemsBase).href;
    let src = url;
    if (globalThis.crypto?.subtle !== undefined) {
      try {
        const response = await this.fetchImpl(url);
        if (!response.ok) throw new Error(`missing (HTTP ${response.status} for ${url})`);
        const bytes = await response.arrayBuffer();
        if ((await sha256Hex(bytes)) !== hex) throw new Error('content does not match its hash');
        if (token !== this.loadToken) return;
        src = this.mediaUrl = URL.createObjectURL(new Blob([bytes], { type: recording.type }));
      } catch (error) {
        if (token !== this.loadToken) return;
        return this.fail([`fallback recording  ${recording.hash}  ${(error as Error).message}`]);
      }
    }
    if (token !== this.loadToken) return;
    const media = this.ensureMedia();
    media.src = src;
    media.load();
    this.ui.play.disabled = false;
    this.setStatus(
      [`Fixed recording of seed ${recording.seed} · ${reasonText}`, ...details].join('\n'),
    );
    this.dispatchEvent(
      new CustomEvent('ready', { detail: { seed: recording.seed, bars: recording.bars } }),
    );
  }

  /** Back to generative mode: releases the recording and re-enables the seed controls. */
  private leaveFallback(): void {
    if (this.media) {
      this.media.pause();
      this.media.removeAttribute('src');
      this.media.load();
    }
    if (this.mediaUrl) URL.revokeObjectURL(this.mediaUrl);
    this.mediaUrl = null;
    this.fallback = null;
    for (const control of [this.ui.seed, this.ui.reroll, this.ui.bars]) control.disabled = false;
    this.ui.lanes.hidden = false;
  }

  private ensureMedia(): HTMLAudioElement {
    if (this.media) return this.media;
    const media = (this.media = new Audio());
    media.preload = 'auto';
    const sized = () => {
      if (!this.fallback) return;
      this.ui.scrub.max = String(this.totalFrames);
      this.ui.scrub.disabled = this.totalFrames === 0;
      this.renderPosition(this.position);
    };
    media.addEventListener('loadedmetadata', sized);
    media.addEventListener('durationchange', sized);
    media.addEventListener('ended', () => {
      if (!this.fallback) return;
      this.playing = false;
      cancelAnimationFrame(this.animation);
      this.ui.play.textContent = 'Play';
      this.renderPosition(this.totalFrames);
      this.dispatchEvent(new CustomEvent('ended'));
    });
    return media;
  }

  private async playFallback(): Promise<void> {
    const media = this.media;
    if (!media || this.playing || this.ui.play.disabled) return;
    if (media.ended) media.currentTime = 0;
    try {
      await media.play();
    } catch (error) {
      this.setStatus(`could not play the fixed recording: ${(error as Error).message}`, true);
      return;
    }
    this.playing = true;
    this.ui.play.textContent = 'Pause';
    const tick = () => {
      this.renderPosition(this.position);
      if (this.playing) this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }

  private async ensureAudio(): Promise<EngineNode> {
    if (!this.context) {
      this.context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'playback' });
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.context.destination);
    }
    if (!this.engine) {
      this.engine = await EngineNode.create(this.context, this.workletUrl);
      this.engine.node.connect(this.gain!);
      this.engine.onPosition = (frame, playing) => {
        this.lastFrame = frame;
        this.lastTime = this.context!.currentTime;
        if (!playing) this.renderPosition(frame);
      };
      this.engine.onEnded = (frame) => {
        this.playing = false;
        this.lastFrame = frame;
        cancelAnimationFrame(this.animation);
        this.ui.play.textContent = 'Play';
        this.renderPosition(frame);
        this.dispatchEvent(new CustomEvent('ended'));
      };
    }
    if (this.engineLoaded !== this.perf && this.perf) {
      await this.engine.load(this.perf.plan, this.perf.stems);
      this.engineLoaded = this.perf;
      this.engine.seek(this.lastFrame);
    }
    return this.engine;
  }

  private ramp(to: number): void {
    const t = this.context!.currentTime;
    const g = this.gain!.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + FADE_SECONDS);
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, FADE_SECONDS * 1000 + 2));
  }

  async play(): Promise<void> {
    if (this.fallback) return this.playFallback();
    if (!this.perf || this.playing) return;
    let engine: EngineNode;
    try {
      engine = await this.ensureAudio();
    } catch (error) {
      const { manifest } = this.perf;
      if (!manifest.fallback) throw error;
      await this.enterFallback(manifest, 'worklet', this.loadToken);
      return this.playFallback();
    }
    await this.context!.resume();
    if (this.lastFrame >= this.perf.plan.totalFrames) this.lastFrame = 0;
    this.lastTime = this.context!.currentTime;
    this.playing = true;
    engine.play();
    this.ramp(1);
    this.ui.play.textContent = 'Pause';
    const tick = () => {
      this.renderPosition(this.position);
      if (this.playing) this.animation = requestAnimationFrame(tick);
    };
    this.animation = requestAnimationFrame(tick);
  }

  async pause(): Promise<void> {
    if (this.fallback) {
      if (!this.playing) return;
      this.playing = false;
      cancelAnimationFrame(this.animation);
      this.ui.play.textContent = 'Play';
      this.media?.pause();
      this.renderPosition(this.position);
      return;
    }
    if (!this.playing || !this.engine) return;
    this.lastFrame = this.position;
    this.playing = false;
    cancelAnimationFrame(this.animation);
    this.ui.play.textContent = 'Play';
    this.ramp(0);
    await this.wait();
    this.engine.pause();
  }

  private async stop(): Promise<void> {
    await this.pause();
    this.lastFrame = 0;
    this.engineLoaded = null;
  }

  /** Moves to `frame` (clamped to the render). Playback, if running, continues from there. */
  async seek(frame: number): Promise<void> {
    if (this.fallback) {
      if (!this.media) return;
      const target = Math.max(0, Math.min(Math.round(frame), this.totalFrames));
      this.media.currentTime = target / SAMPLE_RATE;
      this.renderPosition(target);
      return;
    }
    if (!this.perf) return;
    const target = Math.max(0, Math.min(Math.round(frame), this.perf.plan.totalFrames));
    if (this.playing && this.engine) {
      this.ramp(0);
      await this.wait();
      this.engine.seek(target);
      this.lastFrame = target;
      this.lastTime = this.context!.currentTime;
      this.ramp(1);
    } else {
      this.lastFrame = target;
      this.engine?.seek(target);
    }
    this.renderPosition(target);
  }

  /** Seeks to the start of `bar`. */
  seekToBar(bar: number): Promise<void> {
    const manifest = this.fallback?.manifest ?? this.perf?.manifest;
    return manifest ? this.seek(barFrame(manifest, bar)) : Promise.resolve();
  }

  /**
   * The current page URL with `seed` and `bars` set to this performance (for the fixed recording,
   * the seed and length it was rendered from).
   */
  link(): string {
    const url = new URL(location.href);
    url.searchParams.set('seed', this.fallback?.recording.seed ?? this.seed ?? '');
    url.searchParams.set('bars', String(this.fallback?.recording.bars ?? this.bars));
    return url.href;
  }

  private async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.link());
      this.setStatus('Link copied');
    } catch {
      this.setStatus(this.link());
    }
  }

  private updateTime(frame: number): void {
    this.ui.time.textContent = `${clock(frame)} / ${clock(this.totalFrames)}`;
  }

  private renderPosition(frame: number): void {
    this.ui.scrub.value = String(frame);
    this.updateTime(frame);
    this.lanes.setPosition(frame);
  }
}
