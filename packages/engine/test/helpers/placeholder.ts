import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeWav,
  synthesizeStemWav,
  type ClipRecipe,
  type Manifest,
  type Stem,
} from '../../src/index.js';

export const repoRoot = join(import.meta.dirname, '../../../..');
export const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256')
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest('hex');

export function loadPlaceholder(): { manifest: Manifest; recipes: Record<string, ClipRecipe> } {
  const read = (file: string) =>
    JSON.parse(readFileSync(join(repoRoot, 'pieces/placeholder', file), 'utf8'));
  return { manifest: read('manifest.json') as Manifest, recipes: read('recipes.json') };
}

/** Synthesizes the placeholder stems in memory, keyed by hash (checked against the manifest). */
export function placeholderStems(): Map<string, Stem> {
  const { manifest, recipes } = loadPlaceholder();
  const stems = new Map<string, Stem>();
  for (const [id, recipe] of Object.entries(recipes)) {
    const bytes = synthesizeStemWav(recipe, id);
    const hash = `sha256:${sha256(bytes)}`;
    if (manifest.clips[id]!.hash !== hash)
      throw new Error(`placeholder stem ${id} does not match its hash`);
    stems.set(hash, decodeWav(bytes, hash));
  }
  return stems;
}
