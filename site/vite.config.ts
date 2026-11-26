import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { serveDev } from './dev-serve.js';
import { trackPages } from './release.js';

const repo = join(import.meta.dirname, '..');

/**
 * Development only: serves /pieces/** and /stems/<hex>.{flac,mp3,json} (from .stems/) by content
 * hash. SPITE_PIECES_DIR and SPITE_STEMS_DIR point it at other directories, e.g. a scratch copy of
 * a piece frozen for a check.
 */
function piecesAndStems(): Plugin {
  return {
    name: 'spite-pieces-and-stems',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        serveDev(pathname, {
          piecesDir: resolve(repo, process.env.SPITE_PIECES_DIR ?? 'pieces'),
          stemsDir: resolve(repo, process.env.SPITE_STEMS_DIR ?? '.stems'),
        }).then((response) => {
          if (!response) return next();
          res.statusCode = response.status;
          res.setHeader('Content-Type', response.type);
          res.end(response.body);
        }, next);
      });
    },
  };
}

/**
 * Production only: emits every `pieces/<id>/manifest.json`, and its `versions.json` when the piece
 * has been frozen, byte for byte, at the same paths, and a page at
 * `pieces/<id>/tracks/<track-id>/index.html` for every track in its `release.json`. An invalid
 * `release.json` fails the build. Pack files, READMEs, release files and audio stay out of the
 * build; stems, track audio and frozen manifests come from the stem store (see vercel.json).
 * `origin` is the site's absolute origin for track pages' share metadata. SPITE_PIECES_DIR points
 * it at another pieces directory, as for the dev server.
 */
export function pieceFiles(
  piecesDir = resolve(repo, process.env.SPITE_PIECES_DIR ?? 'pieces'),
  origin?: string,
): Plugin {
  return {
    name: 'spite-piece-files',
    apply: 'build',
    generateBundle() {
      const ids = readdirSync(piecesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const id of ids) {
        let source: Buffer;
        try {
          source = readFileSync(join(piecesDir, id, 'manifest.json'));
        } catch {
          continue;
        }
        this.emitFile({ type: 'asset', fileName: `pieces/${id}/manifest.json`, source });
        try {
          const versions = readFileSync(join(piecesDir, id, 'versions.json'));
          this.emitFile({
            type: 'asset',
            fileName: `pieces/${id}/versions.json`,
            source: versions,
          });
        } catch {
          // Not frozen.
        }
        const tracks = trackPages(piecesDir, id, origin);
        if ('problems' in tracks) {
          this.error(
            `${tracks.file} is invalid:\n${tracks.problems.map((p) => `  ${p}`).join('\n')}`,
          );
        }
        for (const { trackId, html } of tracks.pages) {
          this.emitFile({
            type: 'asset',
            fileName: `pieces/${id}/tracks/${trackId}/index.html`,
            source: html,
          });
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    piecesAndStems(),
    pieceFiles(
      undefined,
      loadEnv(mode, import.meta.dirname, 'VITE_').VITE_SITE_ORIGIN || undefined,
    ),
  ],
  // Pre-bundling would rewrite import.meta.url, which the player uses to find its worklet.
  optimizeDeps: { exclude: ['@spite-store/player'] },
}));
