import { RENDER_FORMAT } from './audio/render.js';
import type { EngineFormats, Manifest } from './manifest.js';
import { TRACE_FORMAT } from './realize.js';

/** The formats of this engine: what a manifest's `engine` pin is compared with. */
export const ENGINE_FORMATS: Readonly<EngineFormats> = Object.freeze({
  trace: TRACE_FORMAT,
  render: RENDER_FORMAT,
});

/** One format on which a manifest's pin and the engine disagree. */
export interface PinMismatch {
  format: 'trace' | 'render';
  pinned: number;
  current: number;
  /** Whether the piece was made with an older or a newer engine than this one. */
  made: 'older' | 'newer';
}

/**
 * Compares a manifest's `engine` pin with the engine's formats. Returns one entry per differing
 * format, trace first; an empty array means the manifest is compatible. An unpinned manifest is
 * always compatible. `current` is the engine's formats, injectable so tests can stand in for a
 * future engine.
 */
export function checkPin(
  manifest: Manifest,
  current: Readonly<EngineFormats> = ENGINE_FORMATS,
): PinMismatch[] {
  const pin = manifest.engine;
  if (pin === undefined) return [];
  const mismatches: PinMismatch[] = [];
  for (const format of ['trace', 'render'] as const) {
    if (pin[format] !== current[format]) {
      mismatches.push({
        format,
        pinned: pin[format],
        current: current[format],
        made: pin[format] < current[format] ? 'older' : 'newer',
      });
    }
  }
  return mismatches;
}

/** One line for a mismatch, e.g. "trace format 2, this engine has 1 (made with a newer engine)". */
export function describePinMismatch(m: PinMismatch): string {
  return `${m.format} format ${m.pinned}, this engine has ${m.current} (made with ${m.made === 'older' ? 'an older' : 'a newer'} engine)`;
}
