import { checkManifest, type Clip, type Manifest, type Section, type Slot } from './manifest.js';
import { normalizeSeed, pathHash, type Seed } from './path.js';
import { createRandom, type Random } from './random.js';

/** Bumped whenever a change to the engine alters the trace for an existing (manifest, seed). */
export const TRACE_FORMAT = 1;
const STATE_VERSION = 1;

export interface TraceEvent {
  bar: number;
  beat: number;
  slot: string;
  clipHash: string;
  gain: number;
}

export interface RealizeOptions {
  durationBars: number;
}

export interface SlotState {
  active: boolean;
  clipId: string | null;
  /** First bar at which the slot needs to pick again. */
  endBar: number;
  pickOrdinal: number;
  history: string[];
}

/** Plain-JSON realization state. Safe to `JSON.stringify` between `advance` calls. */
export interface RealizationState {
  v: number;
  fingerprint: string;
  seed: string;
  durationBars: number;
  /** Next bar to realize. */
  bar: number;
  ended: boolean;
  visit: { ordinal: number; sectionId: string; startBar: number } | null;
  visitCounts: Record<string, number>;
  slots: Record<string, SlotState>;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedKeys = (record: object): string[] => Object.keys(record).sort(byCodeUnit);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return (
      '{' +
      sortedKeys(record)
        .filter((k) => record[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + canonicalJson(record[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

const hex32 = (n: number): string => ('0000000' + n.toString(16)).slice(-8);

/** Identifies a manifest's content, independent of object key order. */
export function manifestFingerprint(manifest: Manifest): string {
  const [lo, hi] = pathHash([canonicalJson(manifest)]);
  return hex32(hi) + hex32(lo);
}

/** Serializes a trace with a fixed key order. `traceHash` is the sha256 of this string. */
export function canonicalTrace(events: readonly TraceEvent[]): string {
  return (
    '[' +
    events
      .map(
        (e) =>
          `{"bar":${JSON.stringify(e.bar)},"beat":${JSON.stringify(e.beat)},"slot":${JSON.stringify(e.slot)},` +
          `"clipHash":${JSON.stringify(e.clipHash)},"gain":${JSON.stringify(e.gain)}}`,
      )
      .join(',') +
    ']'
  );
}

function assertValid(manifest: Manifest): void {
  const errors = checkManifest(manifest);
  if (errors.length > 0) {
    const detail = errors.map((e) => `${e.pointer || '/'}: ${e.message}`).join('; ');
    throw new Error(`Invalid manifest: ${detail}`);
  }
}

function envelopeAt(manifest: Manifest, x: number): number {
  const env = manifest.envelope;
  if (!env) return 1;
  let value = env[env.length - 1]!.value;
  for (let i = 0; i + 1 < env.length; i++) {
    const a = env[i]!;
    const b = env[i + 1]!;
    if (x <= b.at) {
      value = x <= a.at ? a.value : a.value + ((b.value - a.value) * (x - a.at)) / (b.at - a.at);
      break;
    }
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Index of a manifest, so lookups never depend on declaration order. */
interface Index {
  sections: Map<string, Section>;
  maxNoRepeat: number;
}

function buildIndex(manifest: Manifest): Index {
  const sections = new Map<string, Section>();
  let maxNoRepeat = 0;
  for (const s of manifest.sections) {
    sections.set(s.id, s);
    for (const slot of s.slots ?? []) maxNoRepeat = Math.max(maxNoRepeat, slot.noRepeat ?? 0);
  }
  return { sections, maxNoRepeat };
}

function sectionSlots(section: Section): Map<string, Slot> {
  return new Map((section.slots ?? []).map((slot) => [slot.id, slot]));
}

function excludes(a: Clip, aId: string, b: Clip, bId: string): boolean {
  return (a.excludes ?? []).includes(bId) || (b.excludes ?? []).includes(aId);
}

export function createState(
  manifest: Manifest,
  seed: Seed,
  options: RealizeOptions,
): RealizationState {
  assertValid(manifest);
  const { durationBars } = options;
  if (!Number.isSafeInteger(durationBars) || durationBars < 1) {
    throw new RangeError(`durationBars must be a positive integer, got ${String(durationBars)}`);
  }
  const slots: Record<string, SlotState> = {};
  for (const section of manifest.sections) {
    for (const slot of section.slots ?? []) {
      slots[slot.id] = { active: false, clipId: null, endBar: 0, pickOrdinal: 0, history: [] };
    }
  }
  return {
    v: STATE_VERSION,
    fingerprint: manifestFingerprint(manifest),
    seed: normalizeSeed(seed),
    durationBars,
    bar: 0,
    ended: false,
    visit: null,
    visitCounts: {},
    slots,
  };
}

function startVisit(
  manifest: Manifest,
  state: RealizationState,
  random: Random,
  section: Section,
  ordinal: number,
): void {
  const startBar = state.bar;
  state.visit = { ordinal, sectionId: section.id, startBar };
  state.visitCounts[section.id] = (state.visitCounts[section.id] ?? 0) + 1;
  const envelope = envelopeAt(manifest, startBar / state.durationBars);
  const slots = sectionSlots(section);
  for (const slotId of sortedKeys(state.slots)) {
    const slotState = state.slots[slotId]!;
    slotState.clipId = null;
    slotState.endBar = startBar;
    slotState.pickOrdinal = 0;
    const slot = slots.get(slotId);
    slotState.active = slot
      ? random.chance(['v', ordinal, 's', slotId, 'enter'], (slot.enter ?? 1) * envelope)
      : false;
  }
}

/** Picks the next section at the end of a visit, or returns null when the piece ends. */
function nextSection(
  index: Index,
  state: RealizationState,
  random: Random,
  section: Section,
): Section | null {
  const eligible = (section.next ?? [])
    .filter((t) => {
      const target = index.sections.get(t.to)!;
      const visits = state.visitCounts[t.to] ?? 0;
      return t.weight > 0 && (target.maxVisits === undefined || visits < target.maxVisits);
    })
    .sort((a, b) => byCodeUnit(a.to, b.to));
  if (eligible.length === 0) return null;
  const i = random.weightedPick(
    ['v', state.visit!.ordinal, 'next'],
    eligible.map((t) => t.weight),
  );
  return index.sections.get(eligible[i]!.to)!;
}

function pickClip(
  manifest: Manifest,
  index: Index,
  state: RealizationState,
  random: Random,
  slot: Slot,
  visitEnd: number,
): TraceEvent | null {
  const bar = state.bar;
  const slotState = state.slots[slot.id]!;
  const remaining = visitEnd - bar;

  const fitting = slot.pool.filter(
    (p) => p.weight > 0 && manifest.clips[p.clip]!.lengthBars <= remaining,
  );
  if (fitting.length === 0) {
    slotState.clipId = null;
    slotState.endBar = visitEnd;
    return null;
  }

  const sounding: string[] = [];
  for (const otherId of sortedKeys(state.slots)) {
    const other = state.slots[otherId]!;
    if (otherId !== slot.id && other.clipId !== null && other.endBar > bar)
      sounding.push(other.clipId);
  }
  const allowed = fitting.filter((p) => {
    const clip = manifest.clips[p.clip]!;
    return !sounding.some((s) => excludes(clip, p.clip, manifest.clips[s]!, s));
  });
  const pickOrdinal = slotState.pickOrdinal++;
  if (allowed.length === 0) {
    slotState.clipId = null;
    slotState.endBar = bar + 1;
    return null;
  }

  let candidates = allowed;
  for (let n = slot.noRepeat ?? 0; n > 0; n--) {
    const recent = slotState.history.slice(-n);
    const filtered = allowed.filter((p) => !recent.includes(p.clip));
    if (filtered.length > 0) {
      candidates = filtered;
      break;
    }
  }
  candidates = candidates.slice().sort((a, b) => byCodeUnit(a.clip, b.clip));

  const i = random.weightedPick(
    ['v', state.visit!.ordinal, 's', slot.id, 'pick', pickOrdinal],
    candidates.map((p) => p.weight),
  );
  const clipId = candidates[i]!.clip;
  const clip = manifest.clips[clipId]!;
  slotState.clipId = clipId;
  slotState.endBar = bar + clip.lengthBars;
  slotState.history.push(clipId);
  if (slotState.history.length > index.maxNoRepeat) {
    slotState.history.splice(0, slotState.history.length - index.maxNoRepeat);
  }
  return {
    bar,
    beat: 0,
    slot: slot.id,
    clipHash: clip.hash,
    gain: (clip.gain ?? 1) * (slot.gain ?? 1),
  };
}

/**
 * Realizes bars from `state.bar` up to (not including) `untilBar`, capped at `durationBars`.
 * Returns the events and a new state; the input state is not modified.
 */
export function advance(
  manifest: Manifest,
  state: RealizationState,
  untilBar: number,
): { events: TraceEvent[]; state: RealizationState } {
  if (state.v !== STATE_VERSION)
    throw new Error(`Unsupported realization state version ${String(state.v)}`);
  if (state.fingerprint !== manifestFingerprint(manifest)) {
    throw new Error('Realization state belongs to a different manifest');
  }
  if (!Number.isSafeInteger(untilBar) || untilBar < 0) {
    throw new RangeError(`untilBar must be a non-negative integer, got ${String(untilBar)}`);
  }
  const next = JSON.parse(JSON.stringify(state)) as RealizationState;
  const index = buildIndex(manifest);
  const random = createRandom(next.seed);
  const events: TraceEvent[] = [];
  const stop = Math.min(untilBar, next.durationBars);

  while (!next.ended && next.bar < stop) {
    if (next.visit === null) {
      startVisit(manifest, next, random, index.sections.get(manifest.start)!, 0);
    } else {
      const current = index.sections.get(next.visit.sectionId)!;
      if (next.bar === next.visit.startBar + current.lengthBars) {
        const section = nextSection(index, next, random, current);
        if (section === null) {
          next.ended = true;
          break;
        }
        startVisit(manifest, next, random, section, next.visit.ordinal + 1);
      }
    }

    const section = index.sections.get(next.visit!.sectionId)!;
    const visitEnd = next.visit!.startBar + section.lengthBars;
    const slots = sectionSlots(section);
    for (const slotId of sortedKeys(next.slots)) {
      const slotState = next.slots[slotId]!;
      if (!slotState.active || slotState.endBar > next.bar) continue;
      const event = pickClip(manifest, index, next, random, slots.get(slotId)!, visitEnd);
      if (event) events.push(event);
    }
    next.bar++;
  }
  return { events, state: next };
}

/** Realizes a whole piece: the ordered event trace for (manifest, seed, durationBars). */
export function realize(manifest: Manifest, seed: Seed, options: RealizeOptions): TraceEvent[] {
  const state = createState(manifest, seed, options);
  return advance(manifest, state, options.durationBars).events;
}
