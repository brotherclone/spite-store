import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    dts: true,
  },
  {
    // Classic-script build for loading into a bare ECMAScript context (see test/portability).
    entry: { engine: 'src/index.ts' },
    format: 'iife',
    globalName: 'SpiteEngine',
    platform: 'neutral',
    target: 'es2022',
    dts: false,
    clean: false,
  },
]);
