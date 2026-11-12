import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalTrace, realize, renderWav, type Manifest } from '../src/index.js';
import { traceHash } from './helpers/manifests.js';
import { loadPlaceholder, placeholderStems, repoRoot, sha256 } from './helpers/placeholder.js';

// A manifest's `engine` pin gates who may play it; it must never reach a decision path or the
// renderer. Adding, removing or changing it leaves every trace and render byte-identical.
const golden = (file: string) =>
  JSON.parse(readFileSync(join(repoRoot, 'fixtures/golden', file), 'utf8')) as {
    traceHash: string;
    wavSha256: string;
  };

describe('realization ignores the engine pin', () => {
  const river = JSON.parse(
    readFileSync(join(repoRoot, 'pieces/the-river-forgets-to-answer/manifest.json'), 'utf8'),
  ) as Manifest;
  const without: Manifest = { ...river };
  delete without.engine;
  const variants: Manifest[] = [
    { ...without, engine: { trace: 1, render: 1 } },
    without,
    { ...without, engine: { trace: 9, render: 9 } },
  ];

  it.each(['0', '42', 'spite-store'])(
    'River seed %s matches its golden with, without and with a nonsense pin',
    (seed) => {
      const traces = variants.map((m) => canonicalTrace(realize(m, seed, { durationBars: 64 })));
      expect(new Set(traces).size).toBe(1);
      expect(traceHash(realize(variants[0]!, seed, { durationBars: 64 }))).toBe(
        golden(`the-river-forgets-to-answer.${seed}.json`).traceHash,
      );
    },
  );
});

describe('rendering ignores the engine pin', () => {
  it('placeholder seed 42 for 16 bars matches its golden audio with and without a pin', () => {
    const { manifest } = loadPlaceholder();
    const stems = placeholderStems();
    const without: Manifest = { ...manifest };
    delete without.engine;
    for (const m of [{ ...without, engine: { trace: 1, render: 1 } }, without]) {
      const { wav } = renderWav(m, '42', { durationBars: 16 }, stems);
      expect(sha256(wav)).toBe(golden('placeholder.audio.42.json').wavSha256);
    }
  });
});
