import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalTrace, realize, renderWav, type Manifest } from '../src/index.js';
import { traceHash } from './helpers/manifests.js';
import { loadPlaceholder, placeholderStems, repoRoot, sha256 } from './helpers/placeholder.js';

// A manifest's `fallback` names a fixed recording; it must never reach a decision path or the
// renderer. Adding, removing or changing it leaves every trace and render byte-identical.
const fallback = {
  hash: `sha256:${'ab'.repeat(32)}`,
  type: 'audio/mpeg',
  seed: 'spite-store',
  bars: 64,
} as const;

const golden = (file: string) =>
  JSON.parse(readFileSync(join(repoRoot, 'fixtures/golden', file), 'utf8')) as {
    traceHash: string;
    wavSha256: string;
  };

describe('realization ignores the fallback', () => {
  const river = JSON.parse(
    readFileSync(join(repoRoot, 'pieces/the-river-forgets-to-answer/manifest.json'), 'utf8'),
  ) as Manifest;
  const without: Manifest = { ...river };
  delete without.fallback;
  const variants: Manifest[] = [
    without,
    { ...without, fallback },
    { ...without, fallback: { ...fallback, seed: 'other', bars: 7 } },
  ];

  it.each(['0', '42', 'spite-store'])(
    'River seed %s matches its golden with or without',
    (seed) => {
      const traces = variants.map((m) => canonicalTrace(realize(m, seed, { durationBars: 64 })));
      expect(new Set(traces).size).toBe(1);
      expect(traceHash(realize(variants[1]!, seed, { durationBars: 64 }))).toBe(
        golden(`the-river-forgets-to-answer.${seed}.json`).traceHash,
      );
    },
  );
});

describe('rendering ignores the fallback', () => {
  it('placeholder seed 42 for 16 bars matches its golden audio with a fallback added', () => {
    const { manifest } = loadPlaceholder();
    const stems = placeholderStems();
    const { wav } = renderWav({ ...manifest, fallback }, '42', { durationBars: 16 }, stems);
    expect(sha256(wav)).toBe(golden('placeholder.audio.42.json').wavSha256);
  });
});
