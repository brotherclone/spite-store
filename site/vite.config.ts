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

export default defineConfig({
  plugins: [piecesAndStems()],
  // Pre-bundling would rewrite import.meta.url, which the player uses to find its worklet.
  optimizeDeps: { exclude: ['@spite-store/player'] },
});
