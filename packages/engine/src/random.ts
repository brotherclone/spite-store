import { mulhi, mullo, philox4x32 } from './philox.js';
import { pathHash, seedKey, type Path, type Seed, type U64 } from './path.js';

const TWO_32 = 4294967296;
const MAX_DRAW_INDEX = 4 * TWO_32 - 1;

/**
 * Every random value derives from (seed, path, draw index) and nothing else, so draws can happen
 * in any order and adding new decisions never shifts existing ones.
 */
export interface Random {
  readonly seed: string;
  /** Raw uint32 for (seed, path, index). */
  draw(path: Path, index?: number): number;
  /** Uniform in [0, 1). */
  rand(path: Path): number;
  /** True with probability `p`, where 0 ≤ p ≤ 1. */
  chance(path: Path, p: number): boolean;
  /** Uniform integer in [lo, hi]. */
  range(path: Path, lo: number, hi: number): number;
  /** Index `i` with probability `weights[i] / sum(weights)`. Callers fix the order of `weights`. */
  weightedPick(path: Path, weights: readonly number[]): number;
}

function drawWith(key: U64, hash: U64, index: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_DRAW_INDEX) {
    throw new RangeError(`Invalid draw index ${String(index)}`);
  }
  const block = philox4x32([hash[0], hash[1], Math.floor(index / 4), 0], key);
  return block[index % 4]!;
}

export function createRandom(seed: Seed): Random {
  const key = seedKey(seed);
  const normalized = typeof seed === 'number' ? String(seed) : seed;

  const draw = (path: Path, index = 0): number => drawWith(key, pathHash(path), index);
  const rand = (path: Path): number => draw(path, 0) / TWO_32;

  return {
    seed: normalized,
    draw,
    rand,

    chance(path, p) {
      if (typeof p !== 'number' || !(p >= 0 && p <= 1)) {
        throw new RangeError(`chance: probability must be a number in [0, 1], got ${String(p)}`);
      }
      // p * 2^32 is exact, so this compares without rounding. p = 1 is always true, p = 0 never.
      return draw(path, 0) < p * TWO_32;
    },

    range(path, lo, hi) {
      if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo > hi || hi - lo >= TWO_32) {
        throw new RangeError(
          `range: need safe integers lo ≤ hi with hi - lo < 2^32, got ${String(lo)}, ${String(hi)}`,
        );
      }
      const n = hi - lo + 1;
      const hash = pathHash(path);
      if (n === TWO_32) return lo + drawWith(key, hash, 0);
      // Lemire's multiply-and-reject: unbiased, using further draw indices on rejection.
      const threshold = (TWO_32 - n) % n;
      for (let index = 0; ; index++) {
        const x = drawWith(key, hash, index);
        if (mullo(x, n) >= threshold) return lo + mulhi(x, n);
      }
    },

    weightedPick(path, weights) {
      if (!Array.isArray(weights) || weights.length === 0) {
        throw new RangeError('weightedPick: weights must be a non-empty array');
      }
      let total = 0;
      let lastPositive = -1;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i];
        if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) {
          throw new RangeError(
            `weightedPick: weight ${i} must be finite and ≥ 0, got ${String(w)}`,
          );
        }
        total += w;
        if (w > 0) lastPositive = i;
      }
      if (!(total > 0) || !Number.isFinite(total)) {
        throw new RangeError('weightedPick: weights must have a positive, finite total');
      }
      const target = rand(path) * total;
      let acc = 0;
      for (let i = 0; i < weights.length; i++) {
        const w = weights[i]!;
        acc += w;
        if (w > 0 && target < acc) return i;
      }
      // Rounding can leave target ≥ the final sum; it belongs to the last positive weight.
      return lastPositive;
    },
  };
}
