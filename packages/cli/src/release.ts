import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import type { ManifestError } from '@spite-store/engine';
import { describeSchemaError } from './messages.js';
import { VERSIONS_FILE, parseVersions, type VersionEntry } from './versions.js';

/**
 * A piece's release metadata, `pieces/<id>/release.json`: credits, and tracks cut from its frozen
 * versions. Kept outside the manifest so editing it never makes a new version.
 */

export interface Credit {
  name: string;
  role: string;
}

export interface Track {
  id: string;
  title: string;
  /** The frozen version's hash, as recorded in versions.json. */
  version: string;
  seed: string;
  bars: number;
  /** The sha256 of the track's 24-bit FLAC. */
  audio: string;
  frames: number;
}

export interface Release {
  credits: Credit[];
  tracks: Track[];
}

export const RELEASE_FILE = 'release.json';

const require = createRequire(import.meta.url);
const schema: object = require('@spite-store/schema/release.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

const show = (value: unknown) => JSON.stringify(value);

function describe(error: ErrorObject, data: unknown): string {
  const path = error.instancePath;
  if (/\/(bars|frames)$/.test(path) && (error.keyword === 'minimum' || error.keyword === 'type')) {
    return `expected a positive integer, got ${show(valueAt(data, path))}`;
  }
  if (/\/(version|audio)$/.test(path) && error.keyword === 'pattern') {
    return `${show(valueAt(data, path))} is not a valid hash: expected "sha256:" followed by 64 lowercase hex characters`;
  }
  return describeSchemaError(error, data);
}

function valueAt(data: unknown, pointer: string): unknown {
  let value = data;
  for (const key of pointer.split('/').slice(1)) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return value;
}

/**
 * Checks parsed release data: the schema, then the two rules it can't express. `versions` is the
 * piece's version list, or null when the piece has no `versions.json`.
 */
export function checkRelease(
  data: unknown,
  versions: readonly VersionEntry[] | null,
): ManifestError[] {
  if (!validateSchema(data)) {
    return (validateSchema.errors ?? []).map((e) => ({
      pointer:
        e.keyword === 'additionalProperties'
          ? `${e.instancePath}/${String((e.params as { additionalProperty: string }).additionalProperty)}`
          : e.instancePath,
      message: describe(e, data),
    }));
  }
  const tracks = (data as { tracks?: Track[] }).tracks ?? [];
  const errors: ManifestError[] = [];
  if (tracks.length > 0 && versions === null) {
    errors.push({
      pointer: '/tracks',
      message: `the piece has no frozen versions (no ${VERSIONS_FILE}), so it can't have tracks; run spite freeze first`,
    });
  }
  const seen = new Map<string, number>();
  tracks.forEach((track, i) => {
    const first = seen.get(track.id);
    if (first !== undefined) {
      errors.push({
        pointer: `/tracks/${i}/id`,
        message: `"${track.id}" is already the id of /tracks/${first}; track ids must be unique`,
      });
    } else {
      seen.set(track.id, i);
    }
    if (versions !== null && !versions.some((v) => v.hash === track.version)) {
      errors.push({
        pointer: `/tracks/${i}/version`,
        message: `${track.version} isn't a recorded version of this piece (not in ${VERSIONS_FILE})`,
      });
    }
  });
  return errors;
}

export type LoadedRelease =
  | { none: true }
  | { release: Release; versions: VersionEntry[] }
  | { file: string; errors: ManifestError[] };

/**
 * Loads `<pieceDir>/release.json` and checks it against the schema and the piece's
 * `versions.json`. A piece without the file has none; an invalid one returns its errors.
 */
export function loadRelease(pieceDir: string): LoadedRelease {
  const file = join(pieceDir, RELEASE_FILE);
  if (!existsSync(file)) return { none: true };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      file,
      errors: [{ pointer: '', message: `not valid JSON (${(error as Error).message})` }],
    };
  }
  let versions: VersionEntry[] | null = null;
  const versionsFile = join(pieceDir, VERSIONS_FILE);
  if (existsSync(versionsFile)) {
    const parsed = parseVersions(readFileSync(versionsFile, 'utf8'));
    if ('problems' in parsed) {
      return {
        file,
        errors: parsed.problems.map((p) => ({
          pointer: '',
          message: `the piece's ${VERSIONS_FILE} is invalid: ${p}`,
        })),
      };
    }
    versions = parsed.entries;
  }
  const errors = checkRelease(data, versions);
  if (errors.length > 0) return { file, errors };
  const { credits = [], tracks = [] } = data as Partial<Release>;
  return { release: { credits, tracks }, versions: versions ?? [] };
}

/** Prints release-file errors in the format `spite validate` uses for manifests. */
export function printReleaseErrors(file: string, errors: readonly ManifestError[]): void {
  for (const e of errors) console.error(`${file}  ${e.pointer || '(root)'}  ${e.message}`);
}

/** The release file as `spite track` writes it: two-space JSON with a trailing newline. */
export function formatRelease(data: object): string {
  return JSON.stringify(data, null, 2) + '\n';
}
