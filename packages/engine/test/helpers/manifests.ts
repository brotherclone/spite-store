import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clip, Manifest, Section, TraceEvent } from '../../src/index.js';
import { canonicalTrace } from '../../src/index.js';

export const examplesDir = join(import.meta.dirname, '../../../../schema/examples');

export function loadExample(name: string): Manifest {
  return JSON.parse(readFileSync(join(examplesDir, 'valid', name), 'utf8')) as Manifest;
}

export const hashOf = (id: string): string =>
  'sha256:' + createHash('sha256').update(id).digest('hex');

export function clips(spec: Record<string, number | Partial<Clip>>): Record<string, Clip> {
  return Object.fromEntries(
    Object.entries(spec).map(([id, v]) => [
      id,
      typeof v === 'number'
        ? { hash: hashOf(id), lengthBars: v }
        : { hash: hashOf(id), lengthBars: 1, ...v },
    ]),
  );
}

export function manifest(parts: {
  clips: Record<string, Clip>;
  sections: Section[];
  start?: string;
  envelope?: Manifest['envelope'];
}): Manifest {
  return {
    specVersion: '0.1',
    id: 'test',
    title: 'Test',
    tempo: [{ bar: 0, bpm: 120, meter: [4, 4] }],
    clips: parts.clips,
    start: parts.start ?? parts.sections[0]!.id,
    sections: parts.sections,
    ...(parts.envelope ? { envelope: parts.envelope } : {}),
  };
}

export const traceHash = (events: readonly TraceEvent[]): string =>
  createHash('sha256').update(canonicalTrace(events)).digest('hex');

/** Clip id sounding in each bar for each slot, from a trace and the manifest's clip lengths. */
export function soundingByBar(
  m: Manifest,
  events: readonly TraceEvent[],
): Map<number, Set<string>> {
  const byHash = new Map(Object.entries(m.clips).map(([id, c]) => [c.hash, { id, c }]));
  const result = new Map<number, Set<string>>();
  for (const e of events) {
    const { id, c } = byHash.get(e.clipHash)!;
    for (let b = e.bar; b < e.bar + c.lengthBars; b++) {
      if (!result.has(b)) result.set(b, new Set());
      result.get(b)!.add(id);
    }
  }
  return result;
}
