import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseVersionList } from './src/url.js';
import { renderTrackPage, type PageTrack } from './src/track-page.js';

/**
 * The site's check of a piece's `release.json`, used at build time and by the dev server (never
 * shipped to the browser): the release schema, then the two rules it can't express, which the CLI
 * checks the same way. The CLI is the one to report errors in full; this just has to refuse.
 */

interface Release {
  credits?: { name: string; role: string }[];
  tracks?: (PageTrack & { version: string })[];
}

const schema: object = createRequire(import.meta.url)('@spite-store/schema/release.schema.json');
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

/**
 * Checks parsed release data against the schema and `versions` (the piece's recorded version
 * hexes, or null when it has no `versions.json`). Returns one `<pointer>  <message>` per problem.
 */
export function checkRelease(data: unknown, versions: readonly string[] | null): string[] {
  if (!validate(data)) {
    return (validate.errors ?? []).map((e) => {
      const extra = (e.params as { additionalProperty?: string }).additionalProperty;
      const pointer = extra === undefined ? e.instancePath : `${e.instancePath}/${extra}`;
      return `${pointer || '(root)'}  ${e.message ?? e.keyword}`;
    });
  }
  const tracks = (data as Release).tracks ?? [];
  const problems: string[] = [];
  if (tracks.length > 0 && versions === null) {
    problems.push(`/tracks  the piece has no frozen versions (no versions.json)`);
  }
  const seen = new Set<string>();
  tracks.forEach((track, i) => {
    if (seen.has(track.id)) problems.push(`/tracks/${i}/id  repeated track id "${track.id}"`);
    seen.add(track.id);
    if (versions !== null && !versions.includes(track.version.slice('sha256:'.length))) {
      problems.push(`/tracks/${i}/version  ${track.version} isn't a recorded version`);
    }
  });
  return problems;
}

const readOptional = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

export type TrackPages =
  { pages: { trackId: string; html: string }[] } | { file: string; problems: string[] };

/**
 * Renders every track page of the piece `id` under `piecesDir` from its current `release.json`,
 * `versions.json` and working manifest (for the title). A piece without `release.json` has none.
 */
export function trackPages(piecesDir: string, id: string, origin?: string): TrackPages {
  const dir = join(piecesDir, id);
  const file = join(dir, 'release.json');
  const text = readOptional(file);
  if (text === null) return { pages: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { file, problems: [`(root)  not valid JSON (${(error as Error).message})`] };
  }
  const versionsText = readOptional(join(dir, 'versions.json'));
  let versions: { hex: string; label: string }[] | null = null;
  if (versionsText !== null) {
    const parsed = parseVersionList(versionsText);
    if (typeof parsed === 'string')
      return { file, problems: [`versions.json is invalid: ${parsed}`] };
    versions = parsed;
  }
  const problems = checkRelease(data, versions && versions.map((v) => v.hex));
  if (problems.length > 0) return { file, problems };
  const release = data as Release;
  const tracks = release.tracks ?? [];
  if (tracks.length === 0) return { pages: [] };
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    title?: unknown;
  };
  const pieceTitle = typeof manifest.title === 'string' ? manifest.title : id;
  return {
    pages: tracks.map((track) => ({
      trackId: track.id,
      html: renderTrackPage({
        pieceId: id,
        pieceTitle,
        track,
        label: versions!.find((v) => v.hex === track.version.slice('sha256:'.length))!.label,
        credits: release.credits ?? [],
        origin,
      }),
    })),
  };
}
