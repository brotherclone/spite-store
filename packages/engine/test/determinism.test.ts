import { describe, expect, it } from 'vitest';
import { realize, type Manifest, type TraceEvent } from '../src/index.js';
import { hashOf, loadExample, traceHash } from './helpers/manifests.js';

const minimal = () => loadExample('minimal.json');

/** Recursively rebuilds every object with its keys in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .reverse()
        .map((k) => [k, reverseKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

describe('same seed, identical trace', () => {
  it('is identical across 100 repetitions', () => {
    const m = minimal();
    const hashes = new Set(
      Array.from({ length: 100 }, () => traceHash(realize(m, 'spite', { durationBars: 64 }))),
    );
    expect(hashes.size).toBe(1);
  });

  it('ignores object key order', () => {
    const m = minimal();
    const reordered = reverseKeys(m) as Manifest;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(m));
    for (const seed of [0, 42, 'spite']) {
      expect(realize(reordered, seed, { durationBars: 64 })).toEqual(
        realize(m, seed, { durationBars: 64 }),
      );
    }
  });

  it('ignores declaration order of sections, slots and clips', () => {
    const m = minimal();
    const reordered: Manifest = {
      ...m,
      clips: Object.fromEntries(Object.entries(m.clips).reverse()),
      sections: m.sections
        .map((s) => ({
          ...s,
          slots: [...(s.slots ?? [])].reverse(),
          next: [...(s.next ?? [])].reverse(),
        }))
        .reverse(),
    };
    for (const seed of [0, 42, 'spite']) {
      expect(realize(reordered, seed, { durationBars: 64 })).toEqual(
        realize(m, seed, { durationBars: 64 }),
      );
    }
  });
});

describe('different seeds diverge', () => {
  it('produces at least 15 distinct traces for seeds 0-19', () => {
    const m = minimal();
    const hashes = new Set(
      Array.from({ length: 20 }, (_, seed) => traceHash(realize(m, seed, { durationBars: 64 }))),
    );
    expect(hashes.size).toBeGreaterThanOrEqual(15);
  });
});

describe('decision-path stability', () => {
  it('is unaffected by an unreachable section', () => {
    const m = minimal();
    const extended: Manifest = {
      ...m,
      sections: [
        ...m.sections,
        {
          id: 'aaa-unreachable',
          lengthBars: 3,
          slots: [{ id: 'drums', pool: [{ clip: 'kick-a', weight: 1 }] }],
          next: [{ to: 'verse', weight: 5 }],
        },
      ],
    };
    for (let seed = 0; seed < 10; seed++) {
      expect(realize(extended, seed, { durationBars: 64 })).toEqual(
        realize(m, seed, { durationBars: 64 }),
      );
    }
  });

  it('leaves other slots alone when a slot is added', () => {
    const m = minimal();
    const extended: Manifest = {
      ...m,
      clips: {
        ...m.clips,
        'bell-a': { hash: hashOf('bell-a'), lengthBars: 1 },
        'bell-b': { hash: hashOf('bell-b'), lengthBars: 3 },
      },
      sections: m.sections.map((s) =>
        s.id === 'verse'
          ? {
              ...s,
              slots: [
                ...(s.slots ?? []),
                {
                  id: 'bells',
                  enter: 0.7,
                  pool: [
                    { clip: 'bell-a', weight: 1 },
                    { clip: 'bell-b', weight: 1 },
                  ],
                },
              ],
            }
          : s,
      ),
    };
    for (let seed = 0; seed < 10; seed++) {
      const withBells = realize(extended, seed, { durationBars: 64 });
      expect(withBells.some((e) => e.slot === 'bells')).toBe(true);
      expect(withBells.filter((e) => e.slot !== 'bells')).toEqual(
        realize(m, seed, { durationBars: 64 }),
      );
    }
  });

  it('is prefix-stable without an envelope', () => {
    const m = minimal();
    for (const seed of [0, 42, 'spite-store']) {
      const long = realize(m, seed, { durationBars: 64 });
      expect(realize(m, seed, { durationBars: 32 })).toEqual(
        long.filter((e: TraceEvent) => e.bar < 32),
      );
    }
  });
});
