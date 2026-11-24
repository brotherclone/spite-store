import { readFile } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';

export interface DevResponse {
  status: number;
  type: string;
  body: Buffer | string;
}

const STEM = /^\/stems\/([0-9a-f]{64})\.(flac|mp3|json)$/;
const OLD_WAV_STEM = /^\/stems\/[0-9a-f]{64}\.wav$/;

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
 * (`/stems/<hex>.json`), the last three from `stemsDir`. A WAV
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
