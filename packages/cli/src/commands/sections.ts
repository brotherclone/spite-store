import { advance, createState, type Manifest, type TraceEvent } from '@spite-store/engine';

export interface BarInfo {
  bar: number;
  sectionId: string;
  /** True on the first bar of a section visit. */
  visitStart: boolean;
  events: TraceEvent[];
}

/**
 * Realizes bar by bar so each bar can be labelled with its section visit. Produces exactly the
 * events `realize` would. `endBar` is where the piece ended (or `durationBars`).
 */
export function realizeByBar(
  manifest: Manifest,
  seed: string,
  durationBars: number,
): { bars: BarInfo[]; endBar: number; events: TraceEvent[] } {
  let state = createState(manifest, seed, { durationBars });
  const bars: BarInfo[] = [];
  const events: TraceEvent[] = [];
  let lastOrdinal = -1;
  for (let bar = 0; bar < durationBars; bar++) {
    const step = advance(manifest, state, bar + 1);
    state = step.state;
    if (state.bar <= bar) break; // the piece ended before this bar
    const visit = state.visit!;
    bars.push({
      bar,
      sectionId: visit.sectionId,
      visitStart: visit.ordinal !== lastOrdinal,
      events: step.events,
    });
    lastOrdinal = visit.ordinal;
    events.push(...step.events);
  }
  return { bars, endBar: state.bar, events };
}

/** "intro(4) verse(8) bridge(4) | ended at bar 44" */
export function sectionSummary(
  bars: readonly BarInfo[],
  endBar: number,
  durationBars: number,
): string {
  const visits: string[] = [];
  let count = 0;
  bars.forEach((b, i) => {
    count++;
    const next = bars[i + 1];
    if (!next || next.visitStart) {
      visits.push(`${b.sectionId}(${count})`);
      count = 0;
    }
  });
  return visits.join(' ') + (endBar < durationBars ? ` | ended at bar ${endBar}` : '');
}

/** Clip ids by hash, for naming clips in output. */
export function clipNames(manifest: Manifest): Map<string, string> {
  const names = new Map<string, string>();
  for (const id of Object.keys(manifest.clips).sort()) {
    const hash = manifest.clips[id]!.hash;
    names.set(hash, names.has(hash) ? `${names.get(hash)!}|${id}` : id);
  }
  return names;
}
