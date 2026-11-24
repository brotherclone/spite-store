import { defaultPiece, startPage, webDigest } from './url.js';

// Production builds open on the released piece (site/.env.production); development on the placeholder.
const piece = defaultPiece(import.meta.env.VITE_DEFAULT_PIECE);
const error = document.querySelector<HTMLElement>('#error')!;

void startPage(piece, {
  player: document.querySelector('spite-player')!,
  history,
  location,
  fetch: (url) => fetch(url),
  digest: webDigest,
  // The player is defined only once its manifest is chosen and verified.
  loadPlayer: () => import('@spite-store/player'),
  showError(message) {
    error.textContent = message;
    error.hidden = false;
  },
  setTitle(title) {
    document.querySelector('h1')!.textContent = title;
    document.title = title;
  },
});
