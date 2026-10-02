import { describe, expect, it } from 'vitest';
import { createRandom } from '../src/random.js';

describe('decisions keyed by seed and path', () => {
  it('is independent of draw order', () => {
    const r1 = createRandom(7);
    const a1 = r1.draw(['a']);
    const b1 = r1.draw(['b']);
    const r2 = createRandom(7);
    const b2 = r2.draw(['b']);
    const a2 = r2.draw(['a']);
    expect(a2).toBe(a1);
    expect(b2).toBe(b1);
  });

  it('is undisturbed by unrelated draws', () => {
    const r = createRandom(7);
    const recorded = Array.from({ length: 16 }, (_, i) => r.draw(['x', 3], i));
    for (let i = 0; i < 1000; i++) r.draw(['other', i], i % 7);
    expect(Array.from({ length: 16 }, (_, i) => r.draw(['x', 3], i))).toEqual(recorded);
  });

  it('diverges across seeds', () => {
    const a = createRandom(1);
    const b = createRandom(2);
    let differ = 0;
    for (let i = 0; i < 64; i++) if (a.draw(['p'], i) !== b.draw(['p'], i)) differ++;
    expect(differ).toBeGreaterThanOrEqual(60);
  });

  it('diverges across similar paths', () => {
    const r = createRandom('s');
    const values = new Set([
      r.draw(['slot', 'a', 1]),
      r.draw(['slot', 'a', 2]),
      r.draw(['slot', 'a1']),
    ]);
    expect(values.size).toBe(3);
  });
});

describe('rand', () => {
  it('stays in [0, 1) with mean near 0.5', () => {
    const r = createRandom(3);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const v = r.rand(['u', i]);
      expect(v >= 0 && v < 1).toBe(true);
      sum += v;
    }
    expect(Math.abs(sum / 100_000 - 0.5)).toBeLessThan(0.01);
  });
});

describe('chance', () => {
  it('handles edge probabilities', () => {
    const r = createRandom(5);
    for (let i = 0; i < 10_000; i++) {
      expect(r.chance(['c', i], 0)).toBe(false);
      expect(r.chance(['c', i], 1)).toBe(true);
    }
  });

  it('rejects out-of-range probabilities', () => {
    const r = createRandom(5);
    for (const p of [1.2, -0.1, NaN, Infinity, '0.5']) {
      expect(() => r.chance(['c'], p as number)).toThrow(RangeError);
    }
  });
});

describe('weightedPick', () => {
  it('converges to the weights over 10k trials', () => {
    const r = createRandom(11);
    const counts = [0, 0, 0];
    for (let i = 0; i < 10_000; i++) counts[r.weightedPick(['w', i], [1, 2, 7])]!++;
    const expected = [0.1, 0.2, 0.7];
    counts.forEach((c, i) => expect(Math.abs(c / 10_000 - expected[i]!)).toBeLessThanOrEqual(0.02));
  });

  it('never picks a zero weight', () => {
    const r = createRandom(11);
    for (let i = 0; i < 10_000; i++) expect(r.weightedPick(['z', i], [0, 1, 0])).toBe(1);
  });

  it('rejects invalid weights', () => {
    const r = createRandom(11);
    for (const w of [[], [0, 0], [1, -1], [1, NaN], [1, Infinity]]) {
      expect(() => r.weightedPick(['w'], w)).toThrow(RangeError);
    }
  });
});

describe('range', () => {
  it('is inclusive and uniform', () => {
    const r = createRandom(13);
    const counts = new Map<number, number>();
    for (let i = 0; i < 60_000; i++) {
      const n = r.range(['r', i], 1, 6);
      expect(Number.isInteger(n) && n >= 1 && n <= 6).toBe(true);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const c of counts.values()) expect(Math.abs(c / 60_000 - 1 / 6)).toBeLessThanOrEqual(0.01);
  });

  it('handles degenerate and full-width ranges', () => {
    const r = createRandom(13);
    expect(r.range(['r'], 5, 5)).toBe(5);
    const full = r.range(['r'], 0, 2 ** 32 - 1);
    expect(full).toBe(r.draw(['r']));
    expect(r.range(['r'], -10, -10)).toBe(-10);
  });

  it('rejects invalid bounds', () => {
    const r = createRandom(13);
    expect(() => r.range(['r'], 6, 1)).toThrow(RangeError);
    expect(() => r.range(['r'], 0, 1.5)).toThrow(RangeError);
    expect(() => r.range(['r'], 0, 2 ** 32)).toThrow(RangeError);
  });
});
