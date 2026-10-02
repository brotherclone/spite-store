// Synthesizes the placeholder piece's stems into .stems/<sha256>.wav and checks every hash against
// pieces/placeholder/manifest.json. Run via `pnpm stems:placeholder` (add `-- --update` to rewrite
// the manifest's hashes after a deliberate recipe change).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { synthesizeStemWav } from '@spite-store/engine';

const root = join(import.meta.dirname, '..');
const pieceDir = join(root, 'pieces/placeholder');
const manifestPath = join(pieceDir, 'manifest.json');
const stemsDir = join(root, '.stems');
const update = process.argv.includes('--update');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const recipes = JSON.parse(readFileSync(join(pieceDir, 'recipes.json'), 'utf8'));

mkdirSync(stemsDir, { recursive: true });
const mismatches = [];
for (const id of Object.keys(recipes).sort()) {
  const clip = manifest.clips[id];
  if (!clip) {
    console.error(`recipe "${id}" has no clip in the manifest`);
    process.exit(1);
  }
  const bytes = synthesizeStemWav(recipes[id], id);
  const hex = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(stemsDir, `${hex}.wav`), bytes);
  const actual = `sha256:${hex}`;
  if (clip.hash !== actual) {
    mismatches.push({ id, expected: clip.hash, actual });
    clip.hash = actual;
  }
}
const missing = Object.keys(manifest.clips).filter((id) => !(id in recipes));
if (missing.length > 0) {
  console.error(`clips without a recipe: ${missing.join(', ')}`);
  process.exit(1);
}

const count = Object.keys(recipes).length;
if (mismatches.length === 0) {
  console.log(`${count} stems written to .stems/, all hashes match`);
} else if (update) {
  const options = (await prettier.resolveConfig(manifestPath)) ?? {};
  writeFileSync(
    manifestPath,
    await prettier.format(JSON.stringify(manifest), { ...options, filepath: manifestPath }),
  );
  for (const m of mismatches) console.log(`updated ${m.id}: ${m.actual}`);
  console.log(`${count} stems written to .stems/, manifest hashes updated`);
} else {
  for (const m of mismatches) console.error(`${m.id}  expected ${m.expected}  actual ${m.actual}`);
  console.error(
    `${mismatches.length} stem hash(es) differ from the manifest (rerun with -- --update if intended)`,
  );
  process.exit(1);
}
