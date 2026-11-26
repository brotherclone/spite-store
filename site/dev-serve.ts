import { readFile } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';
import { trackPages } from './release.js';

export interface DevResponse {
  status: number;
  type: string;
  body: Buffer | string;
}

const STEM = /^\/stems\/([0-9a-f]{64})\.(flac|mp3|json)$/;
const OLD_WAV_STEM = /^\/stems\/[0-9a-f]{64}\.wav$/;
const TRACK_PAGE = /^\/pieces\/([a-z0-9][a-z0-9_-]{0,63})\/tracks\/([a-z0-9][a-z0-9_-]{0,63})\/?$/;

const TYPES = { flac: 'audio/flac', mp3: 'audio/mpeg', json: 'application/json' } as const;

const missing = (hex: string, ext: keyof typeof TYPES) =>
  ext === 'mp3'
    ? `fallback recording ${hex} not found in .stems/; run spite fallback for the piece`
    : ext === 'json'
      ? `frozen manifest ${hex} not found in .stems/; run spite freeze for the piece, or copy ${hex}.json from the store`
      : `stem ${hex} not found in .stems/; run pnpm stems:placeholder for the placeholder piece, or spite pack for a recorded piece`;

/**
 * Resolves a development request for pieces (`/pieces/...` from `piecesDir`), stems
 * (`/stems/<hex>.flac`), fallback recordings (`/stems/<hex>.mp3`) or frozen manifests
 * (`/stems/<hex>.json`), the last three from `stemsDir`, and track pages
 * (`/pieces/<id>/tracks/<track-id>/`), rendered from the piece's current files. A WAV
 * stem name gets a 404, even when `.stems/` still holds that file. Returns null for anything else.
 */
export async function serveDev(
  pathname: string,
  dirs: { piecesDir: string; stemsDir: string },
): Promise<DevResponse | null> {
  if (OLD_WAV_STEM.test(pathname)) {
    return { status: 404, type: 'text/plain', body: 'stems are FLAC: request <hex>.flac' };
  }
  const stem = STEM.exec(pathname);
  if (stem) {
    const [, hex, ext] = stem as unknown as [string, string, keyof typeof TYPES];
    try {
      return {
        status: 200,
        type: TYPES[ext],
        body: await readFile(resolve(dirs.stemsDir, `${hex}.${ext}`)),
      };
    } catch {
      return { status: 404, type: 'text/plain', body: missing(hex, ext) };
    }
  }
  const page = TRACK_PAGE.exec(pathname);
  if (page) {
    // Rendered fresh from the piece's files on every request, by the code the build uses.
    const [, piece, trackId] = page as unknown as [string, string, string];
    const result = trackPages(dirs.piecesDir, piece);
    if ('problems' in result) {
      return {
        status: 500,
        type: 'text/plain',
        body: `${result.file} is invalid:\n${result.problems.map((p) => `  ${p}`).join('\n')}`,
      };
    }
    const found = result.pages.find((p) => p.trackId === trackId);
    if (found) return { status: 200, type: 'text/html; charset=utf-8', body: found.html };
    return { status: 404, type: 'text/plain', body: 'not found' };
  }
  if (pathname.startsWith('/pieces/')) {
    const root = resolve(dirs.piecesDir);
    let relative: string;
    try {
      relative = decodeURIComponent(pathname.slice('/pieces/'.length));
    } catch {
      return { status: 400, type: 'text/plain', body: 'bad path' };
    }
    const file = resolve(root, normalize(relative));
    if (file !== root && !file.startsWith(root + sep))
      return { status: 403, type: 'text/plain', body: 'forbidden' };
    try {
      const type = file.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      return { status: 200, type, body: await readFile(file) };
    } catch {
      return { status: 404, type: 'text/plain', body: 'not found' };
    }
  }
  return null;
}
