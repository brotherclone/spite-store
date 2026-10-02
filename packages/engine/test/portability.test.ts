import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { encodeWav16, planRender, realize, realizeForRender, renderAll } from '../src/index.js';
import { createHash } from 'node:crypto';
import { rampStems } from './helpers/stems.js';
import { loadExample, traceHash } from './helpers/manifests.js';

const pkgDir = join(import.meta.dirname, '..');

describe('portability', () => {
  it('runs the built bundle in a bare ECMAScript context with the same trace hash', () => {
    const bundle = readFileSync(join(pkgDir, 'dist/engine.iife.js'), 'utf8');
    const manifest = loadExample('minimal.json');
    // A fresh context has only the ECMAScript built-ins: no DOM, no Node globals, no TextEncoder.
    const context = createContext({});
    expect(runInContext('typeof process + typeof window + typeof TextEncoder', context)).toBe(
      'undefinedundefinedundefined',
    );
    runInContext(bundle, context);
    for (const seed of [0, 42, 'spite-store']) {
      const json = runInContext(
        `JSON.stringify(SpiteEngine.realize(${JSON.stringify(manifest)}, ${JSON.stringify(seed)}, { durationBars: 64 }))`,
        context,
      ) as string;
      expect(traceHash(JSON.parse(json))).toBe(
        traceHash(realize(manifest, seed, { durationBars: 64 })),
      );
    }
  });

  it('renders identical samples in a bare ECMAScript context', () => {
    const bundle = readFileSync(join(pkgDir, 'dist/engine.iife.js'), 'utf8');
    const manifest = loadExample('minimal.json');
    const context = createContext({});
    runInContext(bundle, context);
    runInContext(`var rampStems = ${rampStems.toString()};`, context);
    const bytes = runInContext(
      `(function (m) {
        var r = SpiteEngine.realizeForRender(m, 42, { durationBars: 16 });
        var stems = rampStems(m);
        var out = SpiteEngine.renderAll(SpiteEngine.planRender(m, r.events, r.endBar, stems), stems);
        return SpiteEngine.encodeWav16([out.left, out.right]);
      })(${JSON.stringify(manifest)})`,
      context,
    ) as Uint8Array;
    const { events, endBar } = realizeForRender(manifest, 42, { durationBars: 16 });
    const stems = rampStems(manifest);
    const { left, right } = renderAll(planRender(manifest, events, endBar, stems), stems);
    const sha = (b: Uint8Array) =>
      createHash('sha256')
        .update(Buffer.from(b.buffer, b.byteOffset, b.byteLength))
        .digest('hex');
    expect(sha(bytes)).toBe(sha(encodeWav16([left, right])));
  });

  it('has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
  });
});
