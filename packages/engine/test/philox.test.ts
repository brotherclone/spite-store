import { describe, expect, it } from 'vitest';
import { mulhi, philox4x32 } from '../src/philox.js';

// Known-answer vectors from Random123's kat_vectors (philox4x32 10).
const KAT: [ctr: [number, number, number, number], key: [number, number], out: number[]][] = [
  [
    [0, 0, 0, 0],
    [0, 0],
    [0x6627e8d5, 0xe169c58d, 0xbc57ac4c, 0x9b00dbd8],
  ],
  [
    [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
    [0xffffffff, 0xffffffff],
    [0x408f276d, 0x41c83b0e, 0xa20bc7c6, 0x6d5451fd],
  ],
  [
    [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344],
    [0xa4093822, 0x299f31d0],
    [0xd16cfe09, 0x94fdcceb, 0x5001e420, 0x24126ea1],
  ],
];

describe('philox4x32-10', () => {
  it.each(KAT)('matches Random123 known answer %#', (ctr, key, out) => {
    expect(philox4x32(ctr, key)).toEqual(out);
  });

  it('mulhi agrees with BigInt', () => {
    const samples = [0, 1, 0xffff, 0x10000, 0xffffffff, 0xd2511f53, 0xcd9e8d57, 0x12345678];
    for (const a of samples) {
      for (const b of samples) {
        expect(mulhi(a, b)).toBe(Number((BigInt(a) * BigInt(b)) >> 32n));
      }
    }
  });
});
