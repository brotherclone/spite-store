/**
 * Philox4x32-10 (Salmon et al., "Parallel Random Numbers: As Easy as 1, 2, 3", SC'11).
 *
 * Everything here is exact uint32 arithmetic: `Math.imul` for the low half of a 32x32 product and
 * a 16-bit split for the high half. No float operation can round, so results are bit-identical on
 * every ECMAScript engine.
 */

const M0 = 0xd2511f53;
const M1 = 0xcd9e8d57;
const W0 = 0x9e3779b9;
const W1 = 0xbb67ae85;

/** High 32 bits of the 64-bit product of two uint32 values. */
export function mulhi(a: number, b: number): number {
  const a0 = a & 0xffff;
  const a1 = a >>> 16;
  const b0 = b & 0xffff;
  const b1 = b >>> 16;
  const lo = a0 * b0;
  const mid1 = a1 * b0;
  const mid2 = a0 * b1;
  const carry = ((lo >>> 16) + (mid1 & 0xffff) + (mid2 & 0xffff)) >>> 16;
  return (a1 * b1 + (mid1 >>> 16) + (mid2 >>> 16) + carry) >>> 0;
}

/** Low 32 bits of the 64-bit product of two uint32 values. */
export function mullo(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

/**
 * One Philox4x32-10 block: 128-bit counter, 64-bit key, 128-bit output. Inputs and outputs are
 * uint32 words.
 */
export function philox4x32(
  counter: readonly [number, number, number, number],
  key: readonly [number, number],
): [number, number, number, number] {
  let c0 = counter[0] >>> 0;
  let c1 = counter[1] >>> 0;
  let c2 = counter[2] >>> 0;
  let c3 = counter[3] >>> 0;
  let k0 = key[0] >>> 0;
  let k1 = key[1] >>> 0;
  for (let round = 0; round < 10; round++) {
    if (round > 0) {
      k0 = (k0 + W0) >>> 0;
      k1 = (k1 + W1) >>> 0;
    }
    const hi0 = mulhi(M0, c0);
    const lo0 = mullo(M0, c0);
    const hi1 = mulhi(M1, c2);
    const lo1 = mullo(M1, c2);
    c0 = (hi1 ^ c1 ^ k0) >>> 0;
    c1 = lo1;
    c2 = (hi0 ^ c3 ^ k1) >>> 0;
    c3 = lo0;
  }
  return [c0, c1, c2, c3];
}
