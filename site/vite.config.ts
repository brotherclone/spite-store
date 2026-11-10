import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { serveDev } from './dev-serve.js';

const repo = join(import.meta.dirname, '..');

/** Development only: serves /pieces/** and /stems/<hex>.wav (from .stems/) by content hash. */
function piecesAndStems(): Plugin {
  return {
    name: 'spite-pieces-and-stems',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        serveDev(pathname, {
          piecesDir: join(repo, 'pieces'),
          stemsDir: join(repo, '.stems'),
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
 * Production only: emits every `pieces/<id>/manifest.json`, byte for byte, at the same path. Pack
 * files, READMEs and audio stay out of the build; stems come from the stem store (see vercel.json).
 */
export function pieceManifests(piecesDir = join(repo, 'pieces')): Plugin {
  return {
    name: 'spite-piece-manifests',
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
      }
    },
  };
}

export default defineConfig({
  plugins: [piecesAndStems(), pieceManifests()],
  // Pre-bundling would rewrite import.meta.url, which the player uses to find its worklet.
  optimizeDeps: { exclude: ['@spite-store/player'] },
});
