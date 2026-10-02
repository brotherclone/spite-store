import { describe, expect, it } from 'vitest';
import { applyQuery, followPlayer, type PlayerLike } from '../src/url.js';

function fakePlayer() {
  const attrs = new Map<string, string>();
  let listener: ((event: Event) => void) | null = null;
  const player: PlayerLike = {
    setAttribute: (name, value) => void attrs.set(name, value),
    addEventListener: (_type, l) => void (listener = l),
  };
  const announce = (seed: string, bars: number) =>
    listener!(new CustomEvent('seedchange', { detail: { seed, bars } }));
  return { player, attrs, announce };
}

describe('seed permalinks', () => {
  it('opens a permalink with its seed and bars', () => {
    const { player, attrs } = fakePlayer();
    applyQuery(player, 'http://localhost/?seed=hello&bars=16');
    expect(Object.fromEntries(attrs)).toEqual({ seed: 'hello', bars: '16' });
  });

  it('defaults to 64 bars and leaves the seed to the player', () => {
    const { player, attrs } = fakePlayer();
    applyQuery(player, 'http://localhost/');
    expect(Object.fromEntries(attrs)).toEqual({ bars: '64' });
  });

  it('follows the player with replaceState, keeping other parameters and history length', () => {
    const { player, announce } = fakePlayer();
    const entries = ['http://localhost/?x=1'];
    const location = { href: entries[0]! };
    const history = {
      replaceState: (_d: unknown, _u: string, url: string) => {
        entries[entries.length - 1] = url;
        location.href = url;
      },
    };
    followPlayer(player, history, location);
    announce('tamirobe', 32);
    expect(entries).toHaveLength(1);
    const url = new URL(entries[0]!);
    expect(url.searchParams.get('x')).toBe('1');
    expect(url.searchParams.get('seed')).toBe('tamirobe');
    expect(url.searchParams.get('bars')).toBe('32');
  });
});
