/** Manifest types, mirroring `schema/manifest.schema.json` (specVersion 0.1). */

export interface TempoEntry {
  bar: number;
  bpm: number;
  meter: [beats: number, unit: number];
}

export interface Clip {
  hash: string;
  lengthBars: number;
  gain?: number;
  excludes?: string[];
}

export interface PoolEntry {
  clip: string;
  weight: number;
}

export interface Slot {
  id: string;
  enter?: number;
  gain?: number;
  noRepeat?: number;
  pool: PoolEntry[];
}

export interface Transition {
  to: string;
  weight: number;
}

export interface Section {
  id: string;
  lengthBars: number;
  maxVisits?: number;
  slots?: Slot[];
  next?: Transition[];
}

export interface Breakpoint {
  at: number;
  value: number;
}

export interface Manifest {
  $schema?: string;
  $comment?: string;
  specVersion: '0.1';
  id: string;
  title: string;
  tempo: TempoEntry[];
  clips: Record<string, Clip>;
  start: string;
  sections: Section[];
  envelope?: Breakpoint[];
  /** One fixed recording of the piece. Realization and rendering never read it. */
  fallback?: Fallback;
}

/** A fixed recording of one performance, for players that can't play the piece generatively. */
export interface Fallback {
  hash: string;
  type: 'audio/mpeg';
  /** The seed and length the recording was rendered from. */
  seed: string;
  bars: number;
}

export const FALLBACK_TYPES = ['audio/mpeg'] as const;
const FALLBACK_KEYS = ['bars', 'hash', 'seed', 'type'];

/** A validation error: a JSON Pointer (RFC 6901) into the manifest and a message. */
export interface ManifestError {
  pointer: string;
  message: string;
}

export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function escapePointer(token: string | number): string {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function pointer(...tokens: (string | number)[]): string {
  return tokens.map((t) => '/' + escapePointer(t)).join('');
}

type Json = unknown;

function isObject(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNumber = (v: Json): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: Json, min: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min;
const isUnit = (v: Json): v is number => isNumber(v) && v >= 0 && v <= 1;
const isId = (v: Json): v is string => typeof v === 'string' && ID_PATTERN.test(v);

/**
 * Structural checks: enough of the schema that the engine can refuse malformed input on its own.
 * The JSON Schema remains the authoritative structural definition.
 */
function checkStructure(m: Json): ManifestError[] {
  const errors: ManifestError[] = [];
  const fail = (message: string, ...tokens: (string | number)[]) =>
    errors.push({ pointer: pointer(...tokens), message });

  if (!isObject(m)) {
    fail('manifest must be an object');
    return errors;
  }
  if (m.specVersion !== '0.1') fail('specVersion must be "0.1"', 'specVersion');
  if (!isId(m.id)) fail('id must match ' + ID_PATTERN.source, 'id');
  if (typeof m.title !== 'string' || m.title.length === 0)
    fail('title must be a non-empty string', 'title');
  if (!isId(m.start)) fail('start must be a section id', 'start');

  if (!Array.isArray(m.tempo) || m.tempo.length === 0) {
    fail('tempo must be a non-empty array', 'tempo');
  } else {
    m.tempo.forEach((t, i) => {
      if (!isObject(t)) return fail('tempo entry must be an object', 'tempo', i);
      if (!isInt(t.bar, 0)) fail('bar must be a non-negative integer', 'tempo', i, 'bar');
      if (!isNumber(t.bpm) || t.bpm <= 0) fail('bpm must be positive', 'tempo', i, 'bpm');
      const meter = t.meter;
      if (
        !Array.isArray(meter) ||
        meter.length !== 2 ||
        !isInt(meter[0], 1) ||
        ![1, 2, 4, 8, 16, 32, 64].includes(meter[1] as number)
      ) {
        fail('meter must be [beats, unit] with a power-of-two unit', 'tempo', i, 'meter');
      }
    });
  }

  if (!isObject(m.clips) || Object.keys(m.clips).length === 0) {
    fail('clips must be a non-empty object', 'clips');
  } else {
    for (const id of Object.keys(m.clips).sort()) {
      const c = m.clips[id];
      if (!isId(id)) fail(`clip id "${id}" must match ${ID_PATTERN.source}`, 'clips', id);
      if (!isObject(c)) {
        fail('clip must be an object', 'clips', id);
        continue;
      }
      if (typeof c.hash !== 'string' || !HASH_PATTERN.test(c.hash)) {
        fail('hash must be "sha256:" followed by 64 lowercase hex characters', 'clips', id, 'hash');
      }
      if (!isInt(c.lengthBars, 1))
        fail('lengthBars must be a positive integer', 'clips', id, 'lengthBars');
      if (c.gain !== undefined && !(isNumber(c.gain) && c.gain >= 0))
        fail('gain must be ≥ 0', 'clips', id, 'gain');
      if (c.excludes !== undefined) {
        if (!Array.isArray(c.excludes)) fail('excludes must be an array', 'clips', id, 'excludes');
        else
          c.excludes.forEach(
            (x, k) => isId(x) || fail('excludes must hold clip ids', 'clips', id, 'excludes', k),
          );
      }
    }
  }

  if (!Array.isArray(m.sections) || m.sections.length === 0) {
    fail('sections must be a non-empty array', 'sections');
  } else {
    m.sections.forEach((s, i) => {
      if (!isObject(s)) return fail('section must be an object', 'sections', i);
      if (!isId(s.id)) fail('id must match ' + ID_PATTERN.source, 'sections', i, 'id');
      if (!isInt(s.lengthBars, 1))
        fail('lengthBars must be a positive integer', 'sections', i, 'lengthBars');
      if (s.maxVisits !== undefined && !isInt(s.maxVisits, 1)) {
        fail('maxVisits must be a positive integer', 'sections', i, 'maxVisits');
      }
      if (s.slots !== undefined && !Array.isArray(s.slots))
        fail('slots must be an array', 'sections', i, 'slots');
      if (Array.isArray(s.slots)) {
        s.slots.forEach((slot, j) => {
          const at = ['sections', i, 'slots', j] as const;
          if (!isObject(slot)) return fail('slot must be an object', ...at);
          if (!isId(slot.id)) fail('id must match ' + ID_PATTERN.source, ...at, 'id');
          if (slot.enter !== undefined && !isUnit(slot.enter))
            fail('enter must be in [0, 1]', ...at, 'enter');
          if (slot.gain !== undefined && !(isNumber(slot.gain) && slot.gain >= 0))
            fail('gain must be ≥ 0', ...at, 'gain');
          if (slot.noRepeat !== undefined && !isInt(slot.noRepeat, 0)) {
            fail('noRepeat must be a non-negative integer', ...at, 'noRepeat');
          }
          if (!Array.isArray(slot.pool) || slot.pool.length === 0) {
            fail('pool must be a non-empty array', ...at, 'pool');
          } else {
            slot.pool.forEach((p, k) => {
              if (!isObject(p) || !isId(p.clip))
                fail('pool entry needs a clip id', ...at, 'pool', k);
              else if (!(isNumber(p.weight) && p.weight >= 0))
                fail('weight must be ≥ 0', ...at, 'pool', k, 'weight');
            });
          }
        });
      }
      if (s.next !== undefined && !Array.isArray(s.next))
        fail('next must be an array', 'sections', i, 'next');
      if (Array.isArray(s.next)) {
        s.next.forEach((t, k) => {
          if (!isObject(t) || !isId(t.to))
            fail('transition needs a section id in "to"', 'sections', i, 'next', k);
          else if (!(isNumber(t.weight) && t.weight >= 0))
            fail('weight must be ≥ 0', 'sections', i, 'next', k, 'weight');
        });
      }
    });
  }

  if (m.envelope !== undefined) {
    if (!Array.isArray(m.envelope) || m.envelope.length < 2) {
      fail('envelope must have at least two breakpoints', 'envelope');
    } else {
      m.envelope.forEach((b, i) => {
        if (!isObject(b) || !isUnit(b.at) || !isUnit(b.value)) {
          fail('breakpoint needs "at" and "value" in [0, 1]', 'envelope', i);
        }
      });
    }
  }
  if (m.fallback !== undefined) {
    const f = m.fallback;
    if (!isObject(f)) {
      fail('fallback must be an object', 'fallback');
    } else {
      for (const key of Object.keys(f).sort()) {
        if (!FALLBACK_KEYS.includes(key)) fail(`unknown fallback property "${key}"`, 'fallback');
      }
      if (typeof f.hash !== 'string' || !HASH_PATTERN.test(f.hash))
        fail('hash must be "sha256:" followed by 64 lowercase hex characters', 'fallback', 'hash');
      if (!(FALLBACK_TYPES as readonly Json[]).includes(f.type))
        fail(`type must be one of ${FALLBACK_TYPES.join(', ')}`, 'fallback', 'type');
      if (typeof f.seed !== 'string' || f.seed.length === 0)
        fail('seed must be a non-empty string', 'fallback', 'seed');
      if (!isInt(f.bars, 1)) fail('bars must be a positive integer', 'fallback', 'bars');
    }
  }
  return errors;
}

/** Semantic rules the JSON Schema cannot express. Assumes the structure is valid. */
function checkSemantics(m: Manifest): ManifestError[] {
  const errors: ManifestError[] = [];
  const fail = (message: string, ...tokens: (string | number)[]) =>
    errors.push({ pointer: pointer(...tokens), message });

  // Tempo map: starts at bar 0, strictly increasing.
  if (m.tempo[0]!.bar !== 0)
    fail(`tempo map must start at bar 0, not bar ${m.tempo[0]!.bar}`, 'tempo', 0, 'bar');
  for (let i = 1; i < m.tempo.length; i++) {
    if (m.tempo[i]!.bar <= m.tempo[i - 1]!.bar) {
      fail(
        `tempo bars must strictly increase (bar ${m.tempo[i]!.bar} follows bar ${m.tempo[i - 1]!.bar})`,
        'tempo',
        i,
        'bar',
      );
    }
  }

  // Clip exclusions refer to catalogue clips.
  for (const id of Object.keys(m.clips).sort()) {
    (m.clips[id]!.excludes ?? []).forEach((x, k) => {
      if (!Object.hasOwn(m.clips, x))
        fail(`clip "${id}" excludes unknown clip "${x}"`, 'clips', id, 'excludes', k);
    });
  }

  // Sections: unique ids, valid references, non-degenerate pools.
  const sectionIds = new Set<string>();
  m.sections.forEach((s, i) => {
    if (sectionIds.has(s.id)) fail(`duplicate section id "${s.id}"`, 'sections', i, 'id');
    sectionIds.add(s.id);
  });
  if (!sectionIds.has(m.start)) fail(`start names unknown section "${m.start}"`, 'start');

  m.sections.forEach((s, i) => {
    const slotIds = new Set<string>();
    (s.slots ?? []).forEach((slot, j) => {
      if (slotIds.has(slot.id))
        fail(
          `duplicate slot id "${slot.id}" in section "${s.id}"`,
          'sections',
          i,
          'slots',
          j,
          'id',
        );
      slotIds.add(slot.id);
      slot.pool.forEach((p, k) => {
        if (!Object.hasOwn(m.clips, p.clip)) {
          fail(
            `section "${s.id}" slot "${slot.id}" pool names unknown clip "${p.clip}"`,
            'sections',
            i,
            'slots',
            j,
            'pool',
            k,
            'clip',
          );
        }
      });
      if (!slot.pool.some((p) => p.weight > 0)) {
        fail(
          `section "${s.id}" slot "${slot.id}" pool weights must not all be 0`,
          'sections',
          i,
          'slots',
          j,
          'pool',
        );
      }
    });
    (s.next ?? []).forEach((t, k) => {
      if (!sectionIds.has(t.to)) {
        fail(
          `section "${s.id}" transitions to unknown section "${t.to}"`,
          'sections',
          i,
          'next',
          k,
          'to',
        );
      }
    });
  });

  // Envelope: from at 0 to at 1, strictly increasing.
  if (m.envelope) {
    const env = m.envelope;
    if (env[0]!.at !== 0) fail('envelope must start at at: 0', 'envelope', 0, 'at');
    if (env[env.length - 1]!.at !== 1)
      fail('envelope must end at at: 1', 'envelope', env.length - 1, 'at');
    for (let i = 1; i < env.length; i++) {
      if (env[i]!.at <= env[i - 1]!.at)
        fail('envelope "at" values must strictly increase', 'envelope', i, 'at');
    }
  }
  return errors;
}

/**
 * Checks a parsed manifest. Returns an empty array when it is valid. Structural problems are
 * reported first; semantic rules run only on a structurally valid manifest.
 */
export function checkManifest(manifest: unknown): ManifestError[] {
  const structural = checkStructure(manifest);
  if (structural.length > 0) return structural;
  return checkSemantics(manifest as Manifest);
}
