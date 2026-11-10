import { describe, expect, it } from 'vitest';
import { applyQuery, defaultPiece, followPlayer, type PlayerLike } from '../src/url.js';

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
    expect(Object.fromEntries(attrs)).toEqual({
      src: '/pieces/placeholder/manifest.json',
      seed: 'hello',
      bars: '16',
    });
  });

  it('defaults to 64 bars and leaves the seed to the player', () => {
    const { player, attrs } = fakePlayer();
    applyQuery(player, 'http://localhost/');
    expect(Object.fromEntries(attrs)).toEqual({
      src: '/pieces/placeholder/manifest.json',
      bars: '64',
    });
  });

  it('chooses a piece', () => {
    const { player, attrs } = fakePlayer();
    applyQuery(player, 'http://localhost/?piece=the-river-forgets-to-answer&seed=hello');
    expect(attrs.get('src')).toBe('/pieces/the-river-forgets-to-answer/manifest.json');
    expect(attrs.get('seed')).toBe('hello');
  });

  it.each(['../secret', '', 'UPPER', '%2e%2e'])('ignores the invalid piece %j', (piece) => {
    const { player, attrs } = fakePlayer();
    applyQuery(player, `http://localhost/?piece=${piece}`);
    expect(attrs.get('src')).toBe('/pieces/placeholder/manifest.json');
  });

  it('keeps the piece when the player rerolls', () => {
    const { player, announce } = fakePlayer();
    const location = { href: 'http://localhost/?piece=the-river-forgets-to-answer&seed=a' };
    const history = {
      replaceState: (_d: unknown, _u: string, url: string) => void (location.href = url),
    };
    followPlayer(player, history, location);
    announce('tamirobe', 64);
    const url = new URL(location.href);
    expect(url.searchParams.get('piece')).toBe('the-river-forgets-to-answer');
    expect(url.searchParams.get('seed')).toBe('tamirobe');
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

describe('default piece', () => {
  const RIVER = 'the-river-forgets-to-answer';

  it('opens the configured production default with no query', () => {
    const { player, attrs } = fakePlayer();
    applyQuery(player, 'http://localhost/', defaultPiece(RIVER));
    expect(attrs.get('src')).toBe(`/pieces/${RIVER}/manifest.json`);
  });

  it('still selects the placeholder by name', () => {
    const { player, attrs } = fakePlayer();
    applyQuery(player, 'http://localhost/?piece=placeholder', defaultPiece(RIVER));
    expect(attrs.get('src')).toBe('/pieces/placeholder/manifest.json');
  });

  it.each([
    [undefined, 'placeholder'],
    [RIVER, RIVER],
  ])('ignores an invalid piece with default %s', (configured, expected) => {
    const { player, attrs } = fakePlayer();
    applyQuery(player, 'http://localhost/?piece=../secret', defaultPiece(configured));
    expect(attrs.get('src')).toBe(`/pieces/${expected}/manifest.json`);
  });

  it('falls back to the placeholder when the configured default is not a valid id', () => {
    expect(defaultPiece(undefined)).toBe('placeholder');
    expect(defaultPiece('../x')).toBe('placeholder');
    expect(defaultPiece(RIVER)).toBe(RIVER);
  });
});
