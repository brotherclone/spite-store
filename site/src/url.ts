/** Minimal views of the browser objects the page touches, so the logic can be tested in Node. */
export interface PlayerLike {
  setAttribute(name: string, value: string): void;
  addEventListener(type: 'seedchange', listener: (event: Event) => void): void;
}
export interface HistoryLike {
  replaceState(data: unknown, unused: string, url: string): void;
}

const PIECE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const DEFAULT_PIECE = 'placeholder';

/** The manifest URL for `?piece=`, falling back to the placeholder when absent or not a valid id. */
export function manifestUrl(href: string): string {
  const piece = new URL(href).searchParams.get('piece');
  return `/pieces/${piece !== null && PIECE_ID.test(piece) ? piece : DEFAULT_PIECE}/manifest.json`;
}

/**
 * Passes `?piece=`, `?seed=` and `?bars=` to the player. Without a seed the player picks a random
 * one. The player batches attribute changes, so this all becomes a single load.
 */
export function applyQuery(player: PlayerLike, href: string): void {
  const params = new URL(href).searchParams;
  player.setAttribute('src', manifestUrl(href));
  const seed = params.get('seed');
  const bars = params.get('bars');
  if (seed) player.setAttribute('seed', seed);
  player.setAttribute('bars', bars ?? '64');
}

/** Keeps the page URL in sync with the player without adding history entries. */
export function followPlayer(
  player: PlayerLike,
  history: HistoryLike,
  location: { href: string },
): void {
  player.addEventListener('seedchange', (event) => {
    const { seed, bars } = (event as CustomEvent<{ seed: string; bars: number }>).detail;
    const url = new URL(location.href);
    url.searchParams.set('seed', seed);
    url.searchParams.set('bars', String(bars));
    history.replaceState(null, '', url.href);
  });
}
