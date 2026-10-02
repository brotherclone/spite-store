import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
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

// Real-browser tests for the player: `pnpm test:browser` (needs `pnpm exec playwright install
// chromium firefox webkit` once). Kept out of `pnpm test`.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['test-browser/**/*.test.ts'],
    testTimeout: 60_000,
    provide: { cliTraceSha256 },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
});
