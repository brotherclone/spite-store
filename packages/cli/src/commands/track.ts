import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SAMPLE_RATE, encodeTrackFlac, type Manifest } from '@spite-store/engine';
import { parse } from '../args.js';
import {
  EXIT_INVALID,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  checkPinOrExit,
  positiveInt,
  sha256,
} from '../common.js';
import {
  RELEASE_FILE,
  formatRelease,
  loadRelease,
  printReleaseErrors,
  type Track,
} from '../release.js';
import { renderSeed } from '../render.js';
import { DEFAULT_STEMS_DIR, reportStemProblems } from '../stems.js';
import { validateManifest } from '../validate.js';
import { VERSIONS_FILE, parseVersions } from '../versions.js';

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** The fields that make a track's performance; once recorded they never change. */
const FIXED = ['version', 'seed', 'bars', 'audio'] as const;
const FIELDS = ['title', 'version', 'seed', 'bars', 'audio', 'frames'] as const;

/** `m:ss`, rounded down, for a length in frames at 48 kHz. */
export function formatDuration(frames: number): string {
  const seconds = Math.floor(frames / SAMPLE_RATE);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const show = (value: unknown) => JSON.stringify(value);

function printTrack(prefix: string, track: Track) {
  for (const field of FIELDS) console.error(`${prefix}${field}  ${show(track[field])}`);
}

export function trackCommand(argv: string[]): number {
  const { values, positionals } = parse(argv, {
    id: { type: 'string' },
    version: { type: 'string' },
    seed: { type: 'string' },
    bars: { type: 'string' },
    title: { type: 'string' },
    stems: { type: 'string' },
    update: { type: 'boolean' },
  });
  if (positionals.length !== 1) throw new UsageError('track takes exactly one manifest');
  for (const name of ['id', 'version', 'seed', 'bars', 'title'] as const) {
    if (values[name] === undefined || values[name] === '') {
      throw new UsageError(`track needs --${name}`);
    }
  }
  const id = values.id!;
  if (!ID.test(id)) {
    throw new UsageError(
      `--id "${id}" is not a valid id: use 1-64 lowercase letters, digits, "-" or "_", starting with a letter or digit`,
    );
  }
  const bars = positiveInt('bars', values.bars, 0);
  const label = values.version!;
  const seed = values.seed!;
  const title = values.title!;
  const stemsDir = values.stems ?? DEFAULT_STEMS_DIR;
  const pieceDir = dirname(positionals[0]!);

  // The label, through the piece's version list.
  const versionsFile = join(pieceDir, VERSIONS_FILE);
  if (!existsSync(versionsFile)) {
    console.error(
      `${versionsFile}  no such file; the piece has no frozen versions, so no "${label}"`,
    );
    return EXIT_INVALID;
  }
  const parsed = parseVersions(readFileSync(versionsFile, 'utf8'));
  if ('problems' in parsed) {
    for (const problem of parsed.problems) console.error(`${versionsFile}  ${problem}`);
    return EXIT_INVALID;
  }
  const entry = parsed.entries.find((v) => v.label === label);
  if (!entry) {
    const known = parsed.entries.map((v) => v.label).join(', ');
    console.error(`--version  "${label}" is not a recorded version (recorded: ${known})`);
    return EXIT_INVALID;
  }

  // The frozen manifest, from the stems directory, checked against its hash.
  const hex = entry.hash.slice('sha256:'.length);
  const frozenFile = join(stemsDir, `${hex}.json`);
  if (!existsSync(frozenFile)) {
    console.error(
      `${frozenFile}  ${label} (${entry.hash}) is not in the stems directory; run spite freeze, or copy /stems/${hex}.json from the store`,
    );
    return EXIT_USAGE;
  }
  const frozenBytes = new Uint8Array(readFileSync(frozenFile));
  if (sha256(frozenBytes) !== entry.hash) {
    console.error(
      `${frozenFile}  does not hash to ${entry.hash}; copy /stems/${hex}.json from the store again, or run spite freeze`,
    );
    return EXIT_USAGE;
  }
  let manifest: Manifest;
  try {
    const data: unknown = JSON.parse(new TextDecoder().decode(frozenBytes));
    const errors = validateManifest(data);
    if (errors.length > 0) {
      for (const e of errors)
        console.error(`${frozenFile}  ${e.pointer || '(root)'}  ${e.message}`);
      return EXIT_INVALID;
    }
    manifest = data as Manifest;
  } catch (error) {
    console.error(`${frozenFile}  not valid JSON (${(error as Error).message})`);
    return EXIT_INVALID;
  }
  // A track is a recording of the pinned performance, so there is no --ignore-pin.
  const refused = checkPinOrExit(frozenFile, manifest, { ignorable: false });
  if (refused !== null) return refused;

  const loaded = loadRelease(pieceDir);
  if ('errors' in loaded) {
    printReleaseErrors(loaded.file, loaded.errors);
    return EXIT_INVALID;
  }

  const rendered = renderSeed(manifest, seed, bars, stemsDir);
  if ('problems' in rendered) {
    reportStemProblems(rendered.problems);
    return EXIT_USAGE;
  }
  const flac = encodeTrackFlac(rendered.left, rendered.right);
  const audio = sha256(flac);
  mkdirSync(stemsDir, { recursive: true });
  writeFileSync(join(stemsDir, `${audio.slice('sha256:'.length)}.flac`), flac);
  console.log(
    `${manifest.id}  ${id}  ${audio}  ${formatDuration(rendered.frames)}  ${(flac.byteLength / 1e6).toFixed(1)} MB`,
  );

  const track: Track = {
    id,
    title,
    version: entry.hash,
    seed,
    bars,
    audio,
    frames: rendered.frames,
  };
  const recorded = 'release' in loaded ? loaded.release.tracks.find((t) => t.id === id) : undefined;
  const releaseFile = join(pieceDir, RELEASE_FILE);

  if (!values.update) {
    if (!recorded) {
      console.error(`${releaseFile}  track "${id}" is not recorded; run with --update to record:`);
      printTrack('  ', track);
      return EXIT_INVALID;
    }
    const changed = FIELDS.filter((f) => recorded[f] !== track[f]);
    if (changed.length > 0) {
      for (const f of changed) {
        console.error(
          `${releaseFile}  track "${id}"  ${f}  recorded ${show(recorded[f])}, now ${show(track[f])}`,
        );
      }
      return EXIT_INVALID;
    }
    console.log(`${id}  up to date`);
    return EXIT_OK;
  }

  if (recorded) {
    const changed = FIXED.filter((f) => recorded[f] !== track[f]);
    if (changed.length > 0) {
      console.error(
        `${releaseFile}  track "${id}" is recorded with a different performance; recorded tracks never change (use a new --id)`,
      );
      for (const f of changed) {
        console.error(`  ${f}  recorded ${show(recorded[f])}, new ${show(track[f])}`);
      }
      return EXIT_INVALID;
    }
    if (recorded.title === title) {
      console.log(`${id}  up to date`);
      return EXIT_OK;
    }
  }

  // Edit the file's own object, so fields and tracks this command doesn't own stay as they are.
  const raw: { tracks?: Record<string, unknown>[] } = existsSync(releaseFile)
    ? (JSON.parse(readFileSync(releaseFile, 'utf8')) as { tracks?: Record<string, unknown>[] })
    : {};
  const tracks = (raw.tracks ??= []);
  const existing = tracks.find((t) => t.id === id);
  if (existing) {
    existing.title = title;
  } else {
    tracks.push({ ...track });
  }
  writeFileSync(releaseFile, formatRelease(raw));
  console.log(`${id}  ${existing ? 'retitled' : 'recorded'} in ${releaseFile}`);
  return EXIT_OK;
}
