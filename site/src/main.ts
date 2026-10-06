import '@spite-store/player';
import { applyQuery, followPlayer, manifestUrl } from './url.js';

const player = document.querySelector('spite-player')!;
followPlayer(player, history, location);
applyQuery(player, location.href);

// Head the page with the chosen piece's title.
fetch(manifestUrl(location.href))
  .then((r) => r.json() as Promise<{ title?: string }>)
  .then(({ title }) => {
    if (title) {
      document.querySelector('h1')!.textContent = title;
      document.title = title;
    }
  })
  .catch(() => {});
