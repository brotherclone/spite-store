// Fails the deployment build when a piece isn't pinned to engine formats, or when a stem or
// fallback a piece references isn't in the stem store. A piece pinned to formats other than this
// engine's only warns: it is a released piece stranded by a format bump, and plays its fallback.
// The store's base URL is read from the /stems/:file rewrite in vercel.json, the one place it is
// configured. SPITE_STEMS_BASE overrides it and SPITE_PIECES_DIR the pieces directory (tests point
// them at a local server and a temporary directory).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { checkPin, describePinMismatch } from '@spite-store/engine';

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

const piecesDir = resolve(root, process.env.SPITE_PIECES_DIR ?? 'pieces');
const manifests = readdirSync(piecesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => relative(root, join(piecesDir, e.name, 'manifest.json')))
  .filter((file) => existsSync(join(root, file)))
  .sort();

/** Fails for an unpinned piece; warns for one pinned to other formats. Returns false on failure. */
function checkPins() {
  let ok = true;
  for (const file of manifests) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(root, file), 'utf8'));
    } catch {
      continue; // reported by the stem check, which validates every manifest
    }
    if (manifest.engine === undefined) {
      console.error(`${file}  not pinned: run spite pin --update`);
      ok = false;
      continue;
    }
    const mismatches = checkPin(manifest);
    if (mismatches.length === 0) continue;
    const outcome = manifest.fallback
      ? 'the piece will play its fallback recording'
      : 'the piece will not play (it has no fallback recording)';
    for (const m of mismatches) console.warn(`warning: ${file}  ${describePinMismatch(m)}`);
    console.warn(`warning: ${file}  ${outcome}`);
  }
  return ok;
}

const base =
  process.env.SPITE_STEMS_BASE ?? storeBase(JSON.parse(readFileSync(join(root, 'vercel.json'))));

console.log(`checking the engine pins of ${manifests.length} piece(s)`);
if (!checkPins()) process.exitCode = 1;
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
