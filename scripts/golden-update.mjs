// Regenerates fixtures/golden/ from the built engine. Run via `pnpm golden:update`.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACE_FORMAT, canonicalTrace, realize } from '@spite-store/engine';

const root = join(import.meta.dirname, '..');
const manifestPath = 'schema/examples/valid/minimal.json';
const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
const durationBars = 64;

for (const seed of [0, 42, 'spite-store']) {
  const trace = realize(manifest, seed, { durationBars });
  const traceHash = createHash('sha256').update(canonicalTrace(trace)).digest('hex');
  const file = join(root, 'fixtures/golden', `minimal.${seed}.json`);
  const snapshot = {
    manifest: manifestPath,
    seed,
    durationBars,
    traceFormat: TRACE_FORMAT,
    traceHash,
    trace,
  };
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`${file}  ${traceHash}  (${trace.length} events)`);
}
