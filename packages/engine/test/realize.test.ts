import { describe, expect, it } from 'vitest';
import { createState, manifestFingerprint, realize, type Manifest } from '../src/index.js';
import { clips, hashOf, loadExample, manifest, soundingByBar } from './helpers/manifests.js';

const seeds = Array.from({ length: 50 }, (_, i) => i);

describe('event trace', () => {
  it('has the documented shape and order for the minimal piece', () => {
    const events = realize(loadExample('minimal.json'), 0, { durationBars: 16 });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(Object.keys(e).sort()).toEqual(['bar', 'beat', 'clipHash', 'gain', 'slot']);
      expect(e.bar >= 0 && e.bar < 16 && Number.isInteger(e.bar)).toBe(true);
      expect(e.beat).toBe(0);
    }
    const sorted = [...events].sort(
      (a, b) => a.bar - b.bar || (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0),
    );
    expect(events).toEqual(sorted);
  });

  it('refuses invalid manifests and durations', () => {
    const m = loadExample('minimal.json');
    expect(() => realize({ ...m, start: 'nowhere' }, 0, { durationBars: 16 })).toThrow(
      /Invalid manifest/,
    );
    expect(() => realize(m, 0, { durationBars: 0 })).toThrow(RangeError);
    expect(() => realize(m, 0, { durationBars: 1.5 })).toThrow(RangeError);
    expect(() => realize(m, -1, { durationBars: 4 })).toThrow(/Invalid seed/);
  });

  it('multiplies clip gain by slot gain', () => {
    const m = manifest({
      clips: clips({ a: { lengthBars: 1, gain: 0.5 } }),
      sections: [
        {
          id: 's',
          lengthBars: 1,
          slots: [{ id: 'x', gain: 0.25, pool: [{ clip: 'a', weight: 1 }] }],
        },
      ],
    });
    expect(realize(m, 0, { durationBars: 1 })).toEqual([
      { bar: 0, beat: 0, slot: 'x', clipHash: hashOf('a'), gain: 0.125 },
    ]);
  });

  it('records the manifest fingerprint in the state', () => {
    const m = loadExample('minimal.json');
    expect(createState(m, 0, { durationBars: 8 }).fingerprint).toBe(manifestFingerprint(m));
  });
});

describe('section traversal', () => {
  const loop = (maxVisits?: number): Manifest =>
    manifest({
      clips: clips({ a: 1 }),
      sections: [
        {
          id: 'only',
          lengthBars: 4,
          ...(maxVisits ? { maxVisits } : {}),
          slots: [{ id: 'x', pool: [{ clip: 'a', weight: 1 }] }],
          next: [{ to: 'only', weight: 1 }],
        },
      ],
    });

  it('respects maxVisits', () => {
    const events = realize(loop(2), 0, { durationBars: 100 });
    expect(events.every((e) => e.bar < 8)).toBe(true);
    expect(events.map((e) => e.bar)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('truncates at durationBars', () => {
    const events = realize(loop(), 0, { durationBars: 10 });
    expect(Math.max(...events.map((e) => e.bar))).toBe(9);
  });

  it('ends when no transition is eligible', () => {
    const m = manifest({
      clips: clips({ a: 1 }),
      sections: [
        {
          id: 'a',
          lengthBars: 2,
          slots: [{ id: 'x', pool: [{ clip: 'a', weight: 1 }] }],
          next: [{ to: 'b', weight: 0 }],
        },
        { id: 'b', lengthBars: 2, slots: [{ id: 'x', pool: [{ clip: 'a', weight: 1 }] }] },
      ],
    });
    expect(realize(m, 0, { durationBars: 50 }).map((e) => e.bar)).toEqual([0, 1]);
  });

  it('follows weighted transitions', () => {
    const m = manifest({
      clips: clips({ a: 1, b: 1 }),
      sections: [
        {
          id: 'start',
          lengthBars: 1,
          next: [
            { to: 'left', weight: 1 },
            { to: 'right', weight: 1 },
          ],
        },
        { id: 'left', lengthBars: 1, slots: [{ id: 'x', pool: [{ clip: 'a', weight: 1 }] }] },
        { id: 'right', lengthBars: 1, slots: [{ id: 'x', pool: [{ clip: 'b', weight: 1 }] }] },
      ],
    });
    const outcomes = new Set(seeds.map((s) => realize(m, s, { durationBars: 4 })[0]!.clipHash));
    expect(outcomes).toEqual(new Set([hashOf('a'), hashOf('b')]));
  });
});

describe('slot entry', () => {
  const twoSlots = (enter: number): Manifest =>
    manifest({
      clips: clips({ a: 1, b: 2 }),
      sections: [
        {
          id: 's',
          lengthBars: 4,
          slots: [
            { id: 'maybe', enter, pool: [{ clip: 'a', weight: 1 }] },
            { id: 'always', pool: [{ clip: 'b', weight: 1 }] },
          ],
          next: [{ to: 's', weight: 1 }],
        },
      ],
    });

  it('never enters with probability 0', () => {
    for (const seed of seeds) {
      expect(
        realize(twoSlots(0), seed, { durationBars: 32 }).filter((e) => e.slot === 'maybe'),
      ).toEqual([]);
    }
  });

  it('enters at the first bar of every visit with probability 1', () => {
    for (const seed of seeds.slice(0, 10)) {
      const bars = realize(twoSlots(1), seed, { durationBars: 32 })
        .filter((e) => e.slot === 'always')
        .map((e) => e.bar);
      for (let visitStart = 0; visitStart < 32; visitStart += 4) expect(bars).toContain(visitStart);
    }
  });

  it('is silent for a whole visit when it does not enter', () => {
    for (const seed of seeds) {
      const events = realize(twoSlots(0.5), seed, { durationBars: 32 }).filter(
        (e) => e.slot === 'maybe',
      );
      const visits = new Map<number, number[]>();
      for (const e of events)
        visits.set(Math.floor(e.bar / 4), [...(visits.get(Math.floor(e.bar / 4)) ?? []), e.bar]);
      // Every visit the slot entered plays all four bars (1-bar clips); others are absent entirely.
      for (const [visit, bars] of visits)
        expect(bars).toEqual([0, 1, 2, 3].map((b) => visit * 4 + b));
    }
  });
});

describe('clips stay inside section visits', () => {
  const m = manifest({
    clips: clips({ long: 4, short: 1 }),
    sections: [
      {
        id: 's',
        lengthBars: 6,
        slots: [
          {
            id: 'x',
            pool: [
              { clip: 'long', weight: 100 },
              { clip: 'short', weight: 1 },
            ],
          },
        ],
        next: [{ to: 's', weight: 1 }],
      },
    ],
  });

  it('only picks clips that fit in the remaining bars', () => {
    for (const seed of seeds) {
      for (const e of realize(m, seed, { durationBars: 60 })) {
        const length = e.clipHash === hashOf('long') ? 4 : 1;
        expect((e.bar % 6) + length).toBeLessThanOrEqual(6);
        if (e.bar % 6 >= 3) expect(e.clipHash).toBe(hashOf('short'));
      }
    }
  });

  it('rests until the visit ends when nothing fits', () => {
    const tooLong = manifest({
      clips: clips({ long: 4, short: 1 }),
      sections: [
        {
          id: 's',
          lengthBars: 3,
          slots: [
            { id: 'x', pool: [{ clip: 'long', weight: 1 }] },
            { id: 'y', pool: [{ clip: 'short', weight: 1 }] },
          ],
          next: [{ to: 's', weight: 1 }],
        },
      ],
    });
    expect(realize(tooLong, 0, { durationBars: 9 }).filter((e) => e.slot === 'x')).toEqual([]);
  });
});

describe('no-repeat window', () => {
  const pool = (noRepeat: number): Manifest =>
    manifest({
      clips: clips({ a: 1, b: 1 }),
      sections: [
        {
          id: 's',
          lengthBars: 10,
          slots: [
            {
              id: 'x',
              noRepeat,
              pool: [
                { clip: 'a', weight: 1 },
                { clip: 'b', weight: 1 },
              ],
            },
          ],
          next: [{ to: 's', weight: 1 }],
        },
      ],
    });

  it('never repeats immediately with noRepeat 1, across visits', () => {
    const events = realize(pool(1), 'nr', { durationBars: 200 });
    expect(events).toHaveLength(200);
    for (let i = 1; i < events.length; i++)
      expect(events[i]!.clipHash).not.toBe(events[i - 1]!.clipHash);
  });

  it('shrinks a window larger than the pool and alternates', () => {
    const events = realize(pool(5), 'nr', { durationBars: 50 });
    expect(events).toHaveLength(50);
    for (let i = 1; i < events.length; i++)
      expect(events[i]!.clipHash).not.toBe(events[i - 1]!.clipHash);
  });

  it('repeats freely without a window', () => {
    const events = realize(pool(0), 'nr', { durationBars: 200 });
    expect(events.some((e, i) => i > 0 && e.clipHash === events[i - 1]!.clipHash)).toBe(true);
  });
});

describe('clip exclusions', () => {
  it('never lets excluded clips overlap, in either direction', () => {
    const m = manifest({
      clips: clips({ a: { lengthBars: 2, excludes: ['b'] }, b: 3, c: 1, d: 2 }),
      sections: [
        {
          id: 's',
          lengthBars: 8,
          slots: [
            {
              id: 'x',
              pool: [
                { clip: 'a', weight: 1 },
                { clip: 'c', weight: 1 },
              ],
            },
            {
              id: 'y',
              pool: [
                { clip: 'b', weight: 1 },
                { clip: 'd', weight: 1 },
              ],
            },
          ],
          next: [{ to: 's', weight: 1 }],
        },
      ],
    });
    let sawA = false;
    let sawB = false;
    for (const seed of seeds) {
      for (const ids of soundingByBar(m, realize(m, seed, { durationBars: 64 })).values()) {
        expect(ids.has('a') && ids.has('b')).toBe(false);
        sawA ||= ids.has('a');
        sawB ||= ids.has('b');
      }
    }
    expect(sawA && sawB).toBe(true);
  });

  it('rests one bar when exclusions empty the candidates, then picks again', () => {
    const m = manifest({
      clips: clips({ a: { lengthBars: 2, excludes: ['b'] }, b: 1 }),
      sections: [
        {
          id: 's',
          lengthBars: 4,
          slots: [
            { id: 'x', pool: [{ clip: 'a', weight: 1 }] },
            { id: 'y', pool: [{ clip: 'b', weight: 1 }] },
          ],
        },
      ],
    });
    // x (earlier id) plays a at bars 0 and 2; y is excluded throughout.
    expect(realize(m, 0, { durationBars: 4 }).map((e) => `${e.bar}:${e.slot}`)).toEqual([
      '0:x',
      '2:x',
    ]);
  });
});

describe('form envelope', () => {
  const withEnvelope = (envelope: Manifest['envelope']): Manifest =>
    manifest({
      clips: clips({ a: 1 }),
      sections: [
        {
          id: 's',
          lengthBars: 4,
          slots: [{ id: 'x', pool: [{ clip: 'a', weight: 1 }] }],
          next: [{ to: 's', weight: 1 }],
        },
      ],
      envelope,
    });

  it('silences everything when the envelope is 0', () => {
    const m = withEnvelope([
      { at: 0, value: 0 },
      { at: 1, value: 0 },
    ]);
    for (const seed of seeds) expect(realize(m, seed, { durationBars: 32 })).toEqual([]);
  });

  it('scales entry by the value at visit start', () => {
    // Ramp from 0 to 1: the first visit (progress 0) never enters, the last visits usually do.
    const m = withEnvelope([
      { at: 0, value: 0 },
      { at: 1, value: 1 },
    ]);
    let late = 0;
    for (const seed of seeds) {
      const events = realize(m, seed, { durationBars: 40 });
      expect(events.filter((e) => e.bar < 4)).toEqual([]);
      if (events.some((e) => e.bar >= 36)) late++;
    }
    expect(late).toBeGreaterThan(35);
  });

  it('applies to the minimal example with an envelope', () => {
    expect(() => realize(loadExample('with-envelope.json'), 1, { durationBars: 64 })).not.toThrow();
  });
});
