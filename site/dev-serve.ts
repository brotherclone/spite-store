import { readFile } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';

export interface DevResponse {
  status: number;
  type: string;
  body: Buffer | string;
}

const STEM = /^\/stems\/([0-9a-f]{64})\.(wav|mp3)$/;

/**
 * Resolves a development request for pieces (`/pieces/...` from `piecesDir`), stems
 * (`/stems/<hex>.wav`) or fallback recordings (`/stems/<hex>.mp3`), both from `stemsDir`. Returns
 * null for anything else.
 */
export async function serveDev(
  pathname: string,
  dirs: { piecesDir: string; stemsDir: string },
): Promise<DevResponse | null> {
  const stem = STEM.exec(pathname);
  if (stem) {
    const [, hex, ext] = stem;
    try {
      return {
        status: 200,
        type: ext === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        body: await readFile(resolve(dirs.stemsDir, `${hex}.${ext}`)),
      };
    } catch {
      return {
        status: 404,
        type: 'text/plain',
        body:
          ext === 'mp3'
            ? `fallback recording ${hex} not found in .stems/; run spite fallback for the piece`
            : `stem ${hex} not found in .stems/; run pnpm stems:placeholder for the placeholder piece, or spite pack for a recorded piece`,
      };
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
