import { barFrame } from '@spite-store/engine';
import type { Performance } from './loader.js';

const BAND = 20;
const ROW = 22;
export const LABEL_WIDTH = 64;

/** `pending`: its stem is still loading. `skipped`: left out because its stem was late. */
export type BlockState = 'ready' | 'pending' | 'skipped';

interface Block {
  row: number;
  start: number;
  bodyEnd: number;
  end: number;
  label: string;
  state: BlockState;
}

/**
 * Lays out a performance as lanes: section visits, then one row per slot id (code-unit order).
 * A clip whose stem is still loading spans its clip length (its tail isn't known yet).
 */
export function layoutLanes(
  perf: Performance,
  skipped: ReadonlySet<number> = new Set(),
): {
  rows: string[];
  sections: { label: string; start: number; end: number }[];
  blocks: Block[];
  total: number;
} {
  const { manifest, plan, events, visits } = perf;
  const pending = new Set(perf.pending);
  const rows = [...new Set(plan.voices.map((v) => v.slot))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const clipByHash = new Map(Object.entries(manifest.clips).map(([id, c]) => [c.hash, { id, c }]));
  const blocks = plan.voices.map((voice, i) => {
    const event = events[i]!;
    const clip = clipByHash.get(voice.clipHash)!;
    const clipEnd = barFrame(manifest, event.bar + clip.c.lengthBars);
    const state: BlockState = skipped.has(i) ? 'skipped' : pending.has(i) ? 'pending' : 'ready';
    if (pending.has(i)) {
      const end = Math.min(clipEnd, voice.choke ?? clipEnd);
      return {
        row: rows.indexOf(voice.slot),
        start: voice.start,
        bodyEnd: end,
        end,
        label: clip.id,
        state,
      };
    }
    const bodyEnd = Math.min(voice.end, clipEnd);
    return {
      row: rows.indexOf(voice.slot),
      start: voice.start,
      bodyEnd,
      end: voice.end,
      label: clip.id,
      state,
    };
  });
  const sections = visits.map((v) => ({
    label: v.sectionId,
    start: barFrame(manifest, v.startBar),
    end: barFrame(manifest, v.endBar),
  }));
  const total = perf.final ? plan.totalFrames : barFrame(manifest, perf.endBar);
  return { rows, sections, blocks, total };
}

/** Canvas lane view with a playhead. Clicking maps x to a frame and calls `onSeek`. */
export class Lanes {
  private layout: ReturnType<typeof layoutLanes> | null = null;
  private position = 0;
  onSeek: (frame: number) => void = () => {};

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
  ) {
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener('click', (event) => {
      if (!this.layout) return;
      const rect = canvas.getBoundingClientRect();
      this.onSeek(this.frameAt(event.clientX - rect.left, rect.width));
    });
  }

  /** The frame at horizontal offset `x` (CSS pixels) of a view `width` pixels wide. */
  frameAt(x: number, width: number): number {
    if (!this.layout) return 0;
    const span = Math.max(1, width - LABEL_WIDTH);
    const t = Math.min(1, Math.max(0, (x - LABEL_WIDTH) / span));
    return Math.round(t * this.layout.total);
  }

  /** Horizontal offset (CSS pixels) of `frame` in a view `width` pixels wide. */
  xAt(frame: number, width: number): number {
    const total = this.layout?.total ?? 1;
    return LABEL_WIDTH + (frame / total) * Math.max(1, width - LABEL_WIDTH);
  }

  /** Lays out a performance (or clears the view), keeping `position` for the playhead. */
  setPerformance(
    perf: Performance | null,
    skipped: ReadonlySet<number> = new Set(),
    position = 0,
  ): void {
    this.layout = perf ? layoutLanes(perf, skipped) : null;
    this.position = position;
    const rows = this.layout?.rows.length ?? 0;
    this.canvas.style.height = `${BAND + rows * ROW + 4}px`;
    this.draw();
  }

  setPosition(frame: number): void {
    this.position = frame;
    this.draw();
  }

  draw(): void {
    const canvas = this.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = globalThis.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const layout = this.layout;
    if (!layout) return;
    const style = getComputedStyle(this.host);
    const color = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    const accent = color('--spite-accent', '#d6336c');
    const ink = color('--spite-ink', '#222');
    const band = color('--spite-band', '#e9ecef');
    const pendingColor = color('--spite-pending', '#adb5bd');
    const skippedColor = color('--spite-skipped', '#ced4da');
    g.font = '11px system-ui, sans-serif';
    g.textBaseline = 'middle';

    layout.sections.forEach((s, i) => {
      const x0 = this.xAt(s.start, width);
      const x1 = this.xAt(s.end, width);
      g.fillStyle = i % 2 === 0 ? band : 'transparent';
      g.fillRect(x0, 0, x1 - x0, height);
      g.fillStyle = ink;
      g.fillText(s.label, x0 + 3, BAND / 2, Math.max(0, x1 - x0 - 6));
    });
    layout.rows.forEach((slot, r) => {
      g.fillStyle = ink;
      g.fillText(slot, 4, BAND + r * ROW + ROW / 2, LABEL_WIDTH - 8);
    });
    for (const b of layout.blocks) {
      const y = BAND + b.row * ROW + 3;
      const h = ROW - 6;
      const x0 = this.xAt(b.start, width);
      const xBody = this.xAt(b.bodyEnd, width);
      const x1 = this.xAt(b.end, width);
      if (b.state === 'pending') {
        // Outline only: the clip is coming, but nothing of it can sound yet.
        g.strokeStyle = pendingColor;
        g.lineWidth = 1;
        g.strokeRect(x0 + 0.5, y + 0.5, Math.max(1, xBody - x0 - 2), h - 1);
        g.fillStyle = pendingColor;
        g.fillText(b.label, x0 + 3, y + h / 2, Math.max(0, xBody - x0 - 6));
        continue;
      }
      const fill = b.state === 'skipped' ? skippedColor : accent;
      g.globalAlpha = 0.35;
      g.fillStyle = fill;
      g.fillRect(xBody, y, Math.max(0, x1 - xBody), h);
      g.globalAlpha = 1;
      g.fillRect(x0, y, Math.max(1, xBody - x0 - 1), h);
      g.fillStyle = b.state === 'skipped' ? ink : '#fff';
      g.fillText(b.label, x0 + 3, y + h / 2, Math.max(0, xBody - x0 - 6));
    }
    const px = this.xAt(this.position, width);
    g.fillStyle = ink;
    g.fillRect(Math.round(px) - 1, 0, 2, height);
  }
}
