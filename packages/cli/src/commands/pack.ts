import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodeWav } from '@spite-store/engine';
import { parse } from '../args.js';
import {
  EXIT_INVALID,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  loadManifest,
  rewriteJson,
  sha256,
} from '../common.js';
import {
  checkPackFile,
  planSlices,
  readLayouts,
  type PackFile,
  type SourceAudio,
} from '../pack.js';
import { DEFAULT_STEMS_DIR } from '../stems.js';
import { sliceWav } from '../wavslice.js';

function fail(lines: readonly string[]): number {
  for (const line of lines) console.error(line);
  return EXIT_USAGE;
}

export async function packCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, {
    source: { type: 'string' },
    stems: { type: 'string' },
    update: { type: 'boolean' },
  });
  if (positionals.length !== 1) throw new UsageError('pack takes exactly one manifest');
  if (values.source === undefined) throw new UsageError('pack needs --source <dir>');
  const manifestFile = positionals[0]!;
  const loaded = loadManifest(manifestFile);
  if (!('manifest' in loaded)) return loaded.exit;
  const { manifest } = loaded;

  const packFile = join(dirname(manifestFile), 'pack.json');
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(packFile, 'utf8'));
  } catch (error) {
    const reason =
      error instanceof SyntaxError ? `not valid JSON (${error.message})` : 'cannot be read';
    return fail([`${packFile}  error: ${reason}`]);
  }
  const packProblems = checkPackFile(data, manifest);
  if (packProblems.length > 0) return fail(packProblems.map((p) => `${packFile}  ${p}`));
  const pack = data as PackFile;

  const sources = new Map<string, SourceAudio>();
  const missing: string[] = [];
  for (const name of Object.keys(pack.sources).sort()) {
    const path = join(values.source, pack.sources[name]!.file);
    try {
      const buffer = readFileSync(path);
      const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      sources.set(name, { bytes, sha256: sha256(bytes) });
    } catch {
      missing.push(`source "${name}"  missing (${path})`);
    }
  }
  if (missing.length > 0) return fail(missing);
  const { layouts, problems: formatProblems } = readLayouts(sources);
  if (formatProblems.length > 0) return fail(formatProblems);
  const { slices, problems: rangeProblems } = planSlices(pack, manifest, layouts);
  if (rangeProblems.length > 0) return fail(rangeProblems);

  const changedSources = [...sources].filter(
    ([name, s]) => s.sha256 !== pack.sources[name]!.sha256,
  );
  if (changedSources.length > 0 && !values.update) {
    for (const [name, s] of changedSources) {
      console.error(
        `source "${name}"  ${pack.sources[name]!.file}  expected ${pack.sources[name]!.sha256}  actual ${s.sha256}`,
      );
    }
    console.error('a source has changed; rerun with --update if the change is intended');
    return EXIT_INVALID;
  }

  const stemsDir = values.stems ?? DEFAULT_STEMS_DIR;
  mkdirSync(stemsDir, { recursive: true });
  const clipHashes = new Map<string, string>();
  for (const slice of slices) {
    const bytes = sliceWav(
      sources.get(slice.source)!.bytes,
      layouts.get(slice.source)!,
      slice.start,
      slice.end,
    );
    const hash = sha256(bytes);
    decodeWav(bytes, `${slice.clip} (${hash})`); // the renderer must accept every stem
    writeFileSync(join(stemsDir, `${hash.slice('sha256:'.length)}.wav`), bytes);
    clipHashes.set(slice.clip, hash);
  }
  const written = new Set(clipHashes.values()).size;
  const mismatches = [...clipHashes].filter(([id, hash]) => manifest.clips[id]!.hash !== hash);

  if (values.update) {
    const manifestChanged = await rewriteJson(
      manifestFile,
      (m: { clips: Record<string, { hash: string }> }) => {
        for (const [id, hash] of mismatches) m.clips[id]!.hash = hash;
        return mismatches.length > 0;
      },
    );
    const packChanged = await rewriteJson(packFile, (p: PackFile) => {
      for (const [name, s] of changedSources) p.sources[name]!.sha256 = s.sha256;
      return changedSources.length > 0;
    });
    for (const [id, hash] of mismatches) console.log(`clip ${id}  ${hash}`);
    for (const [name, s] of changedSources) console.log(`source "${name}"  ${s.sha256}`);
    console.log(
      `${written} stem(s) written to ${stemsDir}; updated ${[manifestChanged && manifestFile, packChanged && packFile].filter(Boolean).join(' and ') || 'nothing'}`,
    );
    return EXIT_OK;
  }
  if (mismatches.length > 0) {
    for (const [id, hash] of mismatches) {
      console.error(`clip ${id}  expected ${manifest.clips[id]!.hash}  actual ${hash}`);
    }
    console.error(`${mismatches.length} clip hash(es) differ; rerun with --update to rewrite them`);
    return EXIT_INVALID;
  }
  console.log(
    `${written} stem(s) written to ${stemsDir}; all ${clipHashes.size} clip hashes match`,
  );
  return EXIT_OK;
}
