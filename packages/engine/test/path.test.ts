import { describe, expect, it } from 'vitest';
import { encodePath, normalizeSeed, pathHash, seedKey, utf8 } from '../src/path.js';
import { createRandom } from '../src/random.js';

describe('path encoding', () => {
  it('separates segment boundaries', () => {
    expect(encodePath(['a', 'b'])).not.toEqual(encodePath(['ab']));
    expect(pathHash(['a', 'b'])).not.toEqual(pathHash(['ab']));
  });

  it('separates strings from integers', () => {
    expect(encodePath(['1'])).not.toEqual(encodePath([1]));
    expect(pathHash(['1'])).not.toEqual(pathHash([1]));
  });

  it('encodes integers as 8 big-endian bytes', () => {
    expect(encodePath([2 ** 32 + 5])).toEqual([0x02, 0, 0, 0, 1, 0, 0, 0, 5]);
    expect(encodePath([Number.MAX_SAFE_INTEGER])).toHaveLength(9);
  });

  it('encodes non-ASCII strings as UTF-8', () => {
    for (const text of ['é', '音楽', '🎹', 'a\u0000b', 'ŝpite']) {
      expect(utf8(text)).toEqual([...Buffer.from(text, 'utf8')]);
    }
    expect(utf8('\ud800')).toEqual([...new TextEncoder().encode('\ud800')]);
    expect(pathHash(['音楽'])).not.toEqual(pathHash(['音']));
  });

  it('rejects invalid segments', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, 2 ** 53, null, undefined, {}, true]) {
      expect(() => encodePath([bad as never])).toThrow(/segment/);
    }
  });
});

describe('seed normalization', () => {
  it('treats integers as their decimal string', () => {
    expect(normalizeSeed(42)).toBe('42');
    expect(seedKey(42)).toEqual(seedKey('42'));
    expect(createRandom(42).draw(['p'])).toBe(createRandom('42').draw(['p']));
  });

  it('accepts any string, including non-ASCII', () => {
    expect(seedKey('spite-store')).not.toEqual(seedKey('spite-storé'));
    expect(seedKey('')).toHaveLength(2);
  });

  it.each([-1, 1.5, NaN, null, undefined, Infinity, 2 ** 53, {}, [], true, 10n])(
    'rejects %s',
    (bad) => {
      expect(() => createRandom(bad as never)).toThrow(/Invalid seed/);
    },
  );
});
