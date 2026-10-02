import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRACE_FORMAT, canonicalTrace, realize, type TraceEvent } from '../src/index.js';
import { traceHash } from './helpers/manifests.js';

const root = join(import.meta.dirname, '../../..');

interface Snapshot {
  manifest: string;
  seed: string | number;
  durationBars: number;
  traceFormat: number;
  traceHash: string;
  trace: TraceEvent[];
}

function firstDifference(expected: TraceEvent[], actual: TraceEvent[]): string {
  const length = Math.max(expected.length, actual.length);
  for (let i = 0; i < length; i++) {
    const e = expected[i] ? canonicalTrace([expected[i]!]).slice(1, -1) : '(none)';
    const a = actual[i] ? canonicalTrace([actual[i]!]).slice(1, -1) : '(none)';
    if (e !== a) return `event #${i}: expected ${e}, got ${a}`;
  }
  return 'traces are equal but hashes differ (hash function changed?)';
}

describe('golden traces', () => {
  it.each(['0', '42', 'spite-store'])('minimal.%s.json matches', (name) => {
    const snapshot = JSON.parse(
      readFileSync(join(root, 'fixtures/golden', `minimal.${name}.json`), 'utf8'),
    ) as Snapshot;
    expect(snapshot.traceFormat, 'traceFormat changed: regenerate with pnpm golden:update').toBe(
      TRACE_FORMAT,
    );
    const manifest = JSON.parse(readFileSync(join(root, snapshot.manifest), 'utf8'));
    const trace = realize(manifest, snapshot.seed, { durationBars: snapshot.durationBars });
    const hash = traceHash(trace);
    if (hash !== snapshot.traceHash) {
      expect.fail(
        `Golden drift for seed ${JSON.stringify(snapshot.seed)}: ${firstDifference(snapshot.trace, trace)}. ` +
          'If intended, bump TRACE_FORMAT and run pnpm golden:update.',
      );
    }
  });
});
