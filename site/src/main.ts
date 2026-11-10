import '@spite-store/player';
import { applyQuery, defaultPiece, followPlayer, manifestUrl } from './url.js';

// Production builds open on the released piece (site/.env.production); development on the placeholder.
const piece = defaultPiece(import.meta.env.VITE_DEFAULT_PIECE);
const player = document.querySelector('spite-player')!;
followPlayer(player, history, location);
applyQuery(player, location.href, piece);

// Head the page with the chosen piece's title.
fetch(manifestUrl(location.href, piece))
  .then((r) => r.json() as Promise<{ title?: string }>)
  .then(({ title }) => {
    if (title) {
      document.querySelector('h1')!.textContent = title;
      document.title = title;
    }
  })
  .catch(() => {});
