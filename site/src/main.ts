import '@spite-store/player';
import { applyQuery, followPlayer } from './url.js';

const player = document.querySelector('spite-player')!;
followPlayer(player, history, location);
applyQuery(player, location.href);
