// Fails the deployment build when a piece isn't pinned to engine formats, when a stem or
// fallback a piece references isn't in the stem store, when vercel.json lets Vercel's edge cache
// store proxied stems (see stemEdgeCacheProblems), or when a frozen version a piece records
// in versions.json (its manifest, or a file that manifest references) isn't, or the list itself
// is invalid. A piece pinned to formats other than this
// engine's only warns: it is a released piece stranded by a format bump, and plays its fallback.
// The store's base URL is read from the /stems/:file rewrite in vercel.json, the one place it is
// configured. SPITE_STEMS_BASE overrides it, SPITE_PIECES_DIR the pieces directory and
// SPITE_VERCEL_JSON the config file (tests point them at a local server and temporary files).
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

/**
 * Why vercel.json's edge cache rules for /stems/ are unsafe, or [] when they are safe. Vercel's
 * edge cache keys a proxied stem by its URL alone, so a cached 206 for one range request was served
 * as the whole file to every later request. Every /stems/ path must get
 * `Vercel-CDN-Cache-Control: no-store`; the store caches on its own, and browsers still get the
 * long Cache-Control.
 */
export function stemEdgeCacheProblems(vercel) {
  const samples = [`/stems/${'ab'.repeat(32)}.flac`, `/stems/${'ab'.repeat(32)}.json`];
  const problems = [];
  for (const path of samples) {
    const values = (vercel.headers ?? [])
      .filter((rule) => new RegExp(`^${rule.source}$`).test(path))
      .flatMap((rule) => rule.headers)
      .filter((h) => h.key.toLowerCase() === 'vercel-cdn-cache-control')
      .map((h) => h.value);
    if (!values.some((v) => v.split(',').some((d) => d.trim() === 'no-store'))) {
      problems.push(
        `vercel.json  ${path} doesn't get "Vercel-CDN-Cache-Control: no-store"; without it Vercel's edge caches a range request's 206 and serves it as the whole file`,
      );
    }
  }
  return problems;
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

const vercel = JSON.parse(
  readFileSync(resolve(root, process.env.SPITE_VERCEL_JSON ?? 'vercel.json'), 'utf8'),
);
const base = process.env.SPITE_STEMS_BASE ?? storeBase(vercel);

console.log("checking vercel.json's edge cache rules for /stems/");
for (const problem of stemEdgeCacheProblems(vercel)) {
  console.error(problem);
  process.exitCode = 1;
}

console.log(`checking the engine pins of ${manifests.length} piece(s)`);
if (!checkPins()) process.exitCode = 1;
console.log(`checking ${manifests.length} piece(s) against ${base}`);
/** Runs a spite command, failing the build (but carrying on) when it fails. */
function spite(...args) {
  try {
    execFileSync(process.execPath, [join(root, 'packages/cli/bin/spite.js'), ...args], {
      cwd: root,
      stdio: 'inherit',
    });
  } catch (error) {
    process.exitCode = error.status ?? 1;
  }
}

spite('publish', '--check', base, ...manifests);
console.log(`checking the frozen versions of ${manifests.length} piece(s) against ${base}`);
spite('freeze', '--check', base, ...manifests);
