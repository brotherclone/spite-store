import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeWav, type Manifest, type Stem } from '@spite-store/engine';

export const DEFAULT_STEMS_DIR = '.stems';

export interface StemProblem {
  clipIds: string[];
  hash: string;
  reason: string;
}

/**
 * Loads `<dir>/<hex>.wav` for each hash, verifying the file's sha256 and decoding it. Every
 * problem is collected, so callers can report all missing or invalid stems at once.
 */
export function loadStems(
  manifest: Manifest,
  hashes: Iterable<string>,
  dir: string,
): { stems: Map<string, Stem>; problems: StemProblem[] } {
  const stems = new Map<string, Stem>();
  const problems: StemProblem[] = [];
  for (const hash of [...new Set(hashes)].sort()) {
    const clipIds = Object.keys(manifest.clips)
      .filter((id) => manifest.clips[id]!.hash === hash)
      .sort();
    const file = join(dir, `${hash.slice('sha256:'.length)}.wav`);
    let bytes: Buffer;
    try {
      bytes = readFileSync(file);
    } catch {
      problems.push({ clipIds, hash, reason: `missing (${file})` });
      continue;
    }
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== hash) {
      problems.push({ clipIds, hash, reason: `content of ${file} does not match its hash` });
      continue;
    }
    try {
      stems.set(
        hash,
        decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), hash),
      );
    } catch (error) {
      problems.push({ clipIds, hash, reason: (error as Error).message });
    }
  }
  return { stems, problems };
}

export function reportStemProblems(problems: readonly StemProblem[]): void {
  for (const p of problems) console.error(`stem ${p.clipIds.join(', ')}  ${p.hash}  ${p.reason}`);
  console.error(
    `${problems.length} stem(s) unavailable; for the placeholder piece run pnpm stems:placeholder, for a recorded piece run spite pack`,
  );
}
