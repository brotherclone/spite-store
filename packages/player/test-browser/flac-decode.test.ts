import { decodeFlac } from '@spite-store/engine';
import { describe, expect, inject, it } from 'vitest';
import { placeholder, placeholderStemFiles, sha256Hex } from './helpers.js';

declare module 'vitest' {
  export interface ProvidedContext {
    decodedStemSha256: Record<string, string[]>;
  }
}

describe('the FLAC decoder in the browser', () => {
  it('gives the same Float32 samples as in Node for every placeholder stem', async () => {
    const expected = inject('decodedStemSha256');
    // placeholderStemFiles checks each file against the manifest, so these are the published bytes.
    const files = await placeholderStemFiles();
    const ids = Object.keys(placeholder.clips).sort();
    expect(Object.keys(expected).sort()).toEqual(ids);
    for (const id of ids) {
      const hash = placeholder.clips[id]!.hash;
      const stem = decodeFlac(files.get(hash)!, hash);
      const got = await Promise.all(stem.channels.map((c) => sha256Hex(c)));
      expect(got, id).toEqual(expected[id]);
    }
  });
});
