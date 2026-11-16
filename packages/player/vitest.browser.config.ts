import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFlac, synthesizeStem, type ClipRecipe } from '@spite-store/engine';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// The CLI's trace for the placeholder piece, computed in Node, so the browser tests can check the
// player plays exactly what `spite realize --json` prints.
const repo = join(import.meta.dirname, '../..');
const cliTrace = execFileSync(
  process.execPath,
  [
    join(repo, 'packages/cli/bin/spite.js'),
    'realize',
    'pieces/placeholder/manifest.json',
    '--seed',
    '42',
    '--bars',
    '16',
    '--json',
  ],
  { cwd: repo, encoding: 'utf8' },
).replace(/\n$/, '');
const cliTraceSha256 = createHash('sha256').update(cliTrace).digest('hex');

// The sha256 of each channel's Float32 samples for every placeholder stem, decoded in Node, so the
// browser tests can check that the FLAC decoder gives the same samples in every engine.
const recipes = JSON.parse(
  readFileSync(join(repo, 'pieces/placeholder/recipes.json'), 'utf8'),
) as Record<string, ClipRecipe>;
const decodedStemSha256: Record<string, string[]> = {};
for (const [id, recipe] of Object.entries(recipes)) {
  decodedStemSha256[id] = decodeFlac(synthesizeStem(recipe, id), id).channels.map((c) =>
    createHash('sha256')
      .update(new Uint8Array(c.buffer, c.byteOffset, c.byteLength))
      .digest('hex'),
  );
}

// Real-browser tests for the player: `pnpm test:browser` (needs `pnpm exec playwright install
// chromium firefox webkit` once). Kept out of `pnpm test`.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['test-browser/**/*.test.ts'],
    testTimeout: 60_000,
    provide: { cliTraceSha256, decodedStemSha256 },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
});
