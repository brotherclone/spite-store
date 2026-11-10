import type { Manifest } from './manifest.js';
import type { Seed } from './path.js';
import { advance, createState, type RealizeOptions, type TraceEvent } from './realize.js';

/** One section visit: bars `[startBar, endBar)` as realized (cut short if the piece stops). */
export interface Visit {
  ordinal: number;
  sectionId: string;
  startBar: number;
  endBar: number;
}

/**
 * Realizes a piece and also reports its section visits. The events are exactly those of
 * `realize`; `endBar` is the bar after the last realized bar.
 */
export function realizeTimeline(
  manifest: Manifest,
  seed: Seed,
  options: RealizeOptions,
): { events: TraceEvent[]; endBar: number; visits: Visit[] } {
  const { durationBars } = options;
  let state = createState(manifest, seed, options);
  const events: TraceEvent[] = [];
  const visits: Visit[] = [];
  for (let bar = 0; bar < durationBars; bar++) {
    const step = advance(manifest, state, bar + 1);
    state = step.state;
    if (state.bar <= bar) break; // the piece ended before this bar
    const visit = state.visit!;
    const last = visits[visits.length - 1];
    if (last && last.ordinal === visit.ordinal) {
      last.endBar = bar + 1;
    } else {
      visits.push({
        ordinal: visit.ordinal,
        sectionId: visit.sectionId,
        startBar: bar,
        endBar: bar + 1,
      });
    }
    for (const e of step.events) events.push(e);
  }
  return { events, endBar: state.bar, visits };
}
