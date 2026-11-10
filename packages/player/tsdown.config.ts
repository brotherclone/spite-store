import { defineConfig } from 'tsdown';

// Both entries bundle the engine so each file is self-contained: a worklet module cannot resolve
// bare specifiers, and an embed should need nothing but these two files.
const shared = {
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  noExternal: ['@spite-store/engine'],
} as const;

export default defineConfig([
  { ...shared, entry: ['src/index.ts'], dts: true },
  { ...shared, entry: ['src/worklet.ts'], dts: false, clean: false },
]);
