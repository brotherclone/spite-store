import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  fixedExtension: false,
  dts: false,
  // pack formats JSON with Prettier only when it is installed alongside; never bundle it.
  deps: { neverBundle: ['prettier'] },
});
