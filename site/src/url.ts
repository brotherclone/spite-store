/** Minimal views of the browser objects the page touches, so the logic can be tested in Node. */
export interface PlayerLike {
  setAttribute(name: string, value: string): void;
  addEventListener(type: 'seedchange', listener: (event: Event) => void): void;
}
export interface HistoryLike {
  replaceState(data: unknown, unused: string, url: string): void;
}

/** Passes `?seed=` and `?bars=` to the player. Without a seed the player picks a random one. */
export function applyQuery(player: PlayerLike, href: string): void {
  const params = new URL(href).searchParams;
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
