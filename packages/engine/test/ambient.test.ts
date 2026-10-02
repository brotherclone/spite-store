import { afterEach, describe, expect, it, vi } from 'vitest';
import vectors from './fixtures/draw-vectors.json' with { type: 'json' };
import { createRandom } from '../src/random.js';

interface Vector {
  seed: string | number;
  path: (string | number)[];
  index: number;
  value: number;
}

describe('known-answer vectors', () => {
  it.each(vectors as Vector[])('seed $seed, path $path, index $index', (v) => {
    expect(createRandom(v.seed).draw(v.path, v.index)).toBe(v.value);
  });
});

describe('no ambient randomness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('draws the same values with Math.random and Date replaced by throwing stubs', () => {
    const before = (vectors as Vector[]).map((v) => createRandom(v.seed).draw(v.path, v.index));
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random used');
    });
    vi.stubGlobal(
      'Date',
      new Proxy(Date, {
        construct() {
          throw new Error('Date used');
        },
        get() {
          throw new Error('Date used');
        },
      }),
    );
    const r = createRandom('ambient');
    const after = (vectors as Vector[]).map((v) => createRandom(v.seed).draw(v.path, v.index));
    expect(after).toEqual(before);
    expect(() => [
      r.rand(['a']),
      r.chance(['b'], 0.5),
      r.range(['c'], 1, 6),
      r.weightedPick(['d'], [1, 2]),
    ]).not.toThrow();
  });
});
