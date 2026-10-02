import { realizeTimeline, type Manifest, type TraceEvent, type Visit } from '@spite-store/engine';

export interface BarInfo {
  bar: number;
  sectionId: string;
  /** True on the first bar of a section visit. */
  visitStart: boolean;
  events: TraceEvent[];
}

/** Realizes with the engine's timeline and groups events per bar with their section visit. */
export function realizeByBar(
  manifest: Manifest,
  seed: string,
  durationBars: number,
): { bars: BarInfo[]; endBar: number; events: TraceEvent[]; visits: Visit[] } {
  const { events, endBar, visits } = realizeTimeline(manifest, seed, { durationBars });
  const bars: BarInfo[] = [];
  for (const visit of visits) {
    for (let bar = visit.startBar; bar < visit.endBar; bar++) {
      bars.push({
        bar,
        sectionId: visit.sectionId,
        visitStart: bar === visit.startBar,
        events: [],
      });
    }
  }
  for (const e of events) bars[e.bar]!.events.push(e);
  return { bars, endBar, events, visits };
}

/** "intro(4) verse(8) bridge(4) | ended at bar 44" */
export function sectionSummary(
  visits: readonly Visit[],
  endBar: number,
  durationBars: number,
): string {
  return (
    visits.map((v) => `${v.sectionId}(${v.endBar - v.startBar})`).join(' ') +
    (endBar < durationBars ? ` | ended at bar ${endBar}` : '')
  );
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
