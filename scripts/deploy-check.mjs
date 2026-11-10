// Fails the deployment build when a stem or fallback a piece references isn't in the stem store.
// The store's base URL is read from the /stems/:file rewrite in vercel.json, the one place it is
// configured. SPITE_STEMS_BASE overrides it (tests point it at a local server).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

/** The store base URL (ending in /stems/) from vercel.json's single /stems/:file rewrite. */
export function storeBase(vercel) {
  const rewrites = (vercel.rewrites ?? []).filter((r) => r.source === '/stems/:file');
  if (rewrites.length !== 1) throw new Error('vercel.json needs exactly one /stems/:file rewrite');
  const { destination } = rewrites[0];
  if (!destination.endsWith('/stems/:file'))
    throw new Error(`the /stems/:file rewrite must end in /stems/:file, got ${destination}`);
  return destination.slice(0, -':file'.length);
}

const manifests = readdirSync(join(root, 'pieces'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => join('pieces', e.name, 'manifest.json'))
  .filter((file) => existsSync(join(root, file)))
  .sort();

const base =
  process.env.SPITE_STEMS_BASE ?? storeBase(JSON.parse(readFileSync(join(root, 'vercel.json'))));

console.log(`checking ${manifests.length} piece(s) against ${base}`);
try {
  execFileSync(
    process.execPath,
    [join(root, 'packages/cli/bin/spite.js'), 'publish', '--check', base, ...manifests],
    { cwd: root, stdio: 'inherit' },
  );
} catch (error) {
  process.exitCode = error.status ?? 1;
}
