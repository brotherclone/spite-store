import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  advance,
  canonicalTrace,
  createState,
  realize,
  type Manifest,
  type RealizationState,
  type Slot,
  type TraceEvent,
} from '../src/index.js';
import { loadExample, traceHash } from './helpers/manifests.js';

const root = join(import.meta.dirname, '../../..');
const golden = (seed: string): { traceHash: string; trace: TraceEvent[] } =>
  JSON.parse(readFileSync(join(root, `fixtures/golden/minimal.${seed}.json`), 'utf8')) as {
    traceHash: string;
    trace: TraceEvent[];
  };
const seedOf = (s: string) => (s === 'spite-store' ? s : Number(s));
const strip = (events: TraceEvent[]): TraceEvent[] =>
  events.map((e) => {
    const copy = { ...e };
    delete copy.pan;
    return copy;
  });

/** minimal.json with `pan` set on the verse's bass slot. */
function withPan(pan: Slot['pan']): Manifest {
  const m = loadExample('minimal.json');
  m.sections.find((s) => s.id === 'verse')!.slots!.find((s) => s.id === 'bass')!.pan = pan;
  return m;
}

describe('pan in the trace', () => {
  it.each(['0', '42', 'spite-store'])('leaves the minimal golden for seed %s unchanged', (s) => {
    const events = realize(loadExample('minimal.json'), seedOf(s), { durationBars: 64 });
    expect(traceHash(events)).toBe(golden(s).traceHash);
    expect(events.some((e) => 'pan' in e)).toBe(false);
  });

  it('copies a fixed pan onto every event of its slot and nowhere else', () => {
    const events = realize(withPan(-0.6), 0, { durationBars: 64 });
    // "bass" is also a slot id in the bridge, which has no pan.
    const panned = events.filter((e) => e.pan !== undefined);
    expect(panned.length).toBeGreaterThan(0);
    expect(events.some((e) => e.slot === 'bass' && e.pan === undefined)).toBe(true);
    for (const e of panned) expect([e.slot, e.pan]).toEqual(['bass', -0.6]);
    expect(strip(events)).toEqual(golden('0').trace);
  });

  it('writes pan last in the canonical trace', () => {
    const event: TraceEvent = {
      bar: 3,
      beat: 0,
      slot: 'bass',
      clipHash: 'sha256:x',
      gain: 0.5,
      pan: -0.6,
    };
    expect(canonicalTrace([event])).toBe(
      '[{"bar":3,"beat":0,"slot":"bass","clipHash":"sha256:x","gain":0.5,"pan":-0.6}]',
    );
    const plain = { ...event };
    delete plain.pan;
    expect(canonicalTrace([plain])).toBe(
      '[{"bar":3,"beat":0,"slot":"bass","clipHash":"sha256:x","gain":0.5}]',
    );
  });
});

describe('drawn pan', () => {
  const ranged = () => withPan({ min: -1, max: 1 });

  it.each(['0', '42', 'spite-store'])('moves no other decision for seed %s', (s) => {
    const events = realize(ranged(), seedOf(s), { durationBars: 64 });
    expect(events.some((e) => e.pan !== undefined)).toBe(true);
    expect(strip(events)).toEqual(golden(s).trace);
  });

  it('is reproducible', () => {
    const first = traceHash(realize(ranged(), 'spite', { durationBars: 64 }));
    for (let i = 0; i < 100; i++) {
      expect(traceHash(realize(ranged(), 'spite', { durationBars: 64 }))).toBe(first);
    }
  });

  it('draws positions on the 101-step grid and varies them', () => {
    const pans = realize(ranged(), 0, { durationBars: 64 })
      .map((e) => e.pan)
      .filter((p) => p !== undefined);
    const grid = Array.from({ length: 101 }, (_, k) => -1 + (2 * k) / 100);
    for (const p of pans) expect(grid).toContain(p);
    expect(new Set(pans).size).toBeGreaterThan(1);
  });

  it('resumes exactly through JSON at bar 30', () => {
    const m = ranged();
    const whole = realize(m, 42, { durationBars: 64 });
    const a = advance(m, createState(m, 42, { durationBars: 64 }), 30);
    const state = JSON.parse(JSON.stringify(a.state)) as RealizationState;
    const b = advance(m, state, 64);
    expect([...a.events, ...b.events]).toEqual(whole);
  });
});
