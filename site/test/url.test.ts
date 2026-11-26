import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultPiece,
  followPlayer,
  parseVersionList,
  resolveVersion,
  startPage,
  webDigest,
  type PageDeps,
  type PlayerLike,
} from '../src/url.js';

const root = join(import.meta.dirname, '../..');
const RIVER = 'the-river-forgets-to-answer';
const riverText = readFileSync(join(root, 'pieces', RIVER, 'manifest.json'), 'utf8');
const placeholderText = readFileSync(join(root, 'pieces/placeholder/manifest.json'), 'utf8');
const hexOf = (text: string) => createHash('sha256').update(text).digest('hex');

/** Three frozen versions of the River: its manifest with the first slot's gain changed. */
const versionsOfRiver = [0.5, 0.45, 0.4].map((gain) => {
  const m = JSON.parse(riverText);
  m.sections[0].slots[0].gain = gain;
  const text = JSON.stringify(m, null, 2) + '\n';
  return { text, hex: hexOf(text) };
});
const [V1, V2, V3] = versionsOfRiver as [
  (typeof versionsOfRiver)[0],
  (typeof versionsOfRiver)[0],
  (typeof versionsOfRiver)[0],
];
const list = (...entries: [{ hex: string }, string][]) =>
  JSON.stringify({ versions: entries.map(([v, label]) => ({ hash: `sha256:${v.hex}`, label })) });

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

/**
 * Starts the page at `href` against `files` (path -> text), recording what it did: the player's
 * attributes, the URL after each replaceState, errors, titles and every fetch.
 */
async function open(href: string, files: Record<string, string> = {}, fallback = 'placeholder') {
  const site: Record<string, string> = {
    '/pieces/placeholder/manifest.json': placeholderText,
    [`/pieces/${RIVER}/manifest.json`]: riverText,
    ...files,
  };
  const { player, attrs, announce } = fakePlayer();
  const entries = [href];
  const location = { href };
  const fetched: string[] = [];
  const errors: string[] = [];
  const titles: string[] = [];
  let playerLoaded = false;
  const deps: PageDeps = {
    player,
    location,
    history: {
      replaceState: (_d, _u, url) => {
        entries[entries.length - 1] = url;
        location.href = url;
      },
    },
    fetch: async (url) => {
      fetched.push(url);
      const text = site[url];
      return {
        ok: text !== undefined,
        status: text === undefined ? 404 : 200,
        arrayBuffer: async () => new TextEncoder().encode(text ?? '').buffer as ArrayBuffer,
      };
    },
    digest: webDigest,
    showError: (m) => void errors.push(m),
    setTitle: (t) => void titles.push(t),
    loadPlayer: async () => void (playerLoaded = true),
  };
  const loaded = await startPage(fallback, deps);
  return {
    loaded,
    attrs,
    announce,
    entries,
    url: () => new URL(location.href),
    fetched,
    errors,
    titles,
    playerLoaded: () => playerLoaded,
  };
}

describe('seed permalinks', () => {
  it('opens a permalink with its seed and bars', async () => {
    const page = await open('http://localhost/?seed=hello&bars=16');
    expect(Object.fromEntries(page.attrs)).toEqual({
      src: '/pieces/placeholder/manifest.json',
      seed: 'hello',
      bars: '16',
    });
    expect(page.playerLoaded()).toBe(true);
  });

  it('defaults to 64 bars and leaves the seed to the player', async () => {
    const page = await open('http://localhost/');
    expect(Object.fromEntries(page.attrs)).toEqual({
      src: '/pieces/placeholder/manifest.json',
      bars: '64',
    });
  });

  it('chooses an unfrozen piece and plays its working manifest', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&seed=hello`);
    expect(page.attrs.get('src')).toBe(`/pieces/${RIVER}/manifest.json`);
    expect(page.attrs.get('seed')).toBe('hello');
    expect(page.url().searchParams.has('version')).toBe(false);
    expect(page.titles).toEqual([JSON.parse(riverText).title]);
  });

  it.each(['../secret', '', 'UPPER', '%2e%2e'])('ignores the invalid piece %j', async (piece) => {
    const page = await open(`http://localhost/?piece=${piece}`);
    expect(page.attrs.get('src')).toBe('/pieces/placeholder/manifest.json');
  });

  it('keeps the piece when the player rerolls', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&seed=a`);
    page.announce('tamirobe', 64);
    expect(page.url().searchParams.get('piece')).toBe(RIVER);
    expect(page.url().searchParams.get('seed')).toBe('tamirobe');
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
  it('opens the configured production default with no query', async () => {
    const page = await open('http://localhost/', {}, defaultPiece(RIVER));
    expect(page.attrs.get('src')).toBe(`/pieces/${RIVER}/manifest.json`);
  });

  it('opens the latest frozen version of the production default', async () => {
    const files = {
      [`/pieces/${RIVER}/versions.json`]: list([V1, 'v1']),
      [`/stems/${V1.hex}.json`]: V1.text,
    };
    const page = await open('http://localhost/', files, defaultPiece(RIVER));
    expect(page.attrs.get('src')).toBe(`/stems/${V1.hex}.json`);
    // The piece itself isn't in the URL (it is the default), but the version is.
    expect(page.url().searchParams.get('version')).toBe('v1');
  });

  it('still selects the placeholder by name', async () => {
    const page = await open('http://localhost/?piece=placeholder', {}, defaultPiece(RIVER));
    expect(page.attrs.get('src')).toBe('/pieces/placeholder/manifest.json');
  });

  it.each([
    [undefined, 'placeholder'],
    [RIVER, RIVER],
  ])('ignores an invalid piece with default %s', async (configured, expected) => {
    const page = await open('http://localhost/?piece=../secret', {}, defaultPiece(configured));
    expect(page.attrs.get('src')).toBe(`/pieces/${expected}/manifest.json`);
  });

  it('falls back to the placeholder when the configured default is not a valid id', () => {
    expect(defaultPiece(undefined)).toBe('placeholder');
    expect(defaultPiece('../x')).toBe('placeholder');
    expect(defaultPiece(RIVER)).toBe(RIVER);
  });
});

describe('version resolution', () => {
  const fixtures = join(root, 'packages/cli/test/fixtures/versions');
  const fixture = (kind: string) =>
    readdirSync(join(fixtures, kind)).map((name) => [
      name,
      readFileSync(join(fixtures, kind, name), 'utf8'),
    ]);

  it.each(fixture('valid'))('accepts the CLI fixture valid/%s', (_, text) => {
    expect(Array.isArray(parseVersionList(text))).toBe(true);
  });
  it.each(fixture('invalid'))('rejects the CLI fixture invalid/%s', (_, text) => {
    expect(typeof parseVersionList(text)).toBe('string');
  });

  const two = list([V1, 'v1'], [V2, 'v2']);
  it('resolves a recorded label', () => {
    expect(resolveVersion(RIVER, 'v1', two)).toEqual({ kind: 'frozen', hex: V1.hex, label: 'v1' });
  });
  it('resolves no reference to the latest version', () => {
    expect(resolveVersion(RIVER, null, two)).toEqual({ kind: 'frozen', hex: V2.hex, label: 'v2' });
  });
  it('resolves a hash without the list', () => {
    expect(resolveVersion(RIVER, V3.hex, two)).toEqual({ kind: 'frozen', hex: V3.hex });
    expect(resolveVersion(RIVER, V3.hex, null)).toEqual({ kind: 'frozen', hex: V3.hex });
  });
  it('fails on an unknown label, naming the piece and the label', () => {
    const r = resolveVersion(RIVER, 'v9', two);
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.message).toContain(RIVER);
    expect(r.kind === 'error' && r.message).toContain('v9');
  });
  it('resolves an unfrozen piece without a reference to its working manifest', () => {
    expect(resolveVersion(RIVER, null, null)).toEqual({ kind: 'working', explicit: false });
    expect(resolveVersion(RIVER, null, '{ "versions": [] }')).toEqual({
      kind: 'working',
      explicit: false,
    });
  });
  it('resolves working on purpose', () => {
    expect(resolveVersion(RIVER, 'working', two)).toEqual({ kind: 'working', explicit: true });
  });
  it('fails on an invalid list', () => {
    expect(resolveVersion(RIVER, null, '{"versions":[],"x":1}').kind).toBe('error');
  });
});

describe('versioned piece page', () => {
  const frozen = {
    [`/pieces/${RIVER}/versions.json`]: list([V1, 'v1'], [V2, 'v2']),
    [`/stems/${V1.hex}.json`]: V1.text,
    [`/stems/${V2.hex}.json`]: V2.text,
    [`/stems/${V3.hex}.json`]: V3.text,
  };

  it('plays the latest version of a frozen piece', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}`, frozen);
    expect(page.attrs.get('src')).toBe(`/stems/${V2.hex}.json`);
  });

  it('plays a version by label, even when a later one exists', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&version=v1`, frozen);
    expect(page.attrs.get('src')).toBe(`/stems/${V1.hex}.json`);
    expect(page.url().searchParams.get('version')).toBe('v1');
  });

  it('plays a version by hash, even one the list does not record', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&version=${V3.hex}`, frozen);
    expect(page.attrs.get('src')).toBe(`/stems/${V3.hex}.json`);
    expect(page.url().searchParams.get('version')).toBe(V3.hex);
  });

  it('plays a hash even when the version list cannot be fetched', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&version=${V1.hex}`, {
      [`/stems/${V1.hex}.json`]: V1.text,
    });
    expect(page.attrs.get('src')).toBe(`/stems/${V1.hex}.json`);
  });

  it('names a recorded hash by its label in the URL', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&version=${V1.hex}`, frozen);
    expect(page.url().searchParams.get('version')).toBe('v1');
  });

  it('plays the working manifest on purpose', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&version=working`, frozen);
    expect(page.attrs.get('src')).toBe(`/pieces/${RIVER}/manifest.json`);
    expect(page.url().searchParams.get('version')).toBe('working');
    expect(page.fetched).not.toContain(`/pieces/${RIVER}/versions.json`);
  });

  it('shows an unknown version as an error and gives the player nothing', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&version=v9`, frozen);
    expect(page.errors).toHaveLength(1);
    expect(page.errors[0]).toContain(RIVER);
    expect(page.errors[0]).toContain('v9');
    expect(page.attrs.has('src')).toBe(false);
    expect(page.playerLoaded()).toBe(false);
  });

  it('takes the title from the verified manifest without fetching it again', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}`, frozen);
    expect(page.titles).toEqual([JSON.parse(V2.text).title]);
    expect(page.fetched.filter((u) => u === `/stems/${V2.hex}.json`)).toHaveLength(1);
  });
});

describe('frozen manifest verified before playing', () => {
  it('refuses bytes that do not match the hash', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&version=v1`, {
      [`/pieces/${RIVER}/versions.json`]: list([V1, 'v1']),
      [`/stems/${V1.hex}.json`]: V2.text,
    });
    expect(page.errors[0]).toContain(RIVER);
    expect(page.errors[0]).toContain('v1');
    expect(page.errors[0]).toContain("doesn't match its hash");
    expect(page.attrs.has('src')).toBe(false);
    expect(page.playerLoaded()).toBe(false);
  });

  it('refuses a frozen manifest of another piece', async () => {
    const page = await open(`http://localhost/?piece=placeholder&version=${V1.hex}`, {
      [`/stems/${V1.hex}.json`]: V1.text,
    });
    expect(page.errors[0]).toContain(RIVER);
    expect(page.attrs.has('src')).toBe(false);
  });

  it('refuses a version whose file is missing', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&version=v1`, {
      [`/pieces/${RIVER}/versions.json`]: list([V1, 'v1']),
    });
    expect(page.errors[0]).toContain('v1');
    expect(page.errors[0]).toContain('404');
    expect(page.attrs.has('src')).toBe(false);
  });
});

describe('versioned permalinks', () => {
  const frozen = {
    [`/pieces/${RIVER}/versions.json`]: list([V1, 'v1'], [V2, 'v2']),
    [`/stems/${V1.hex}.json`]: V1.text,
    [`/stems/${V2.hex}.json`]: V2.text,
  };

  it('gives an unversioned link its version on load, without adding history', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&seed=hello`, frozen);
    expect(page.url().search).toBe(`?piece=${RIVER}&seed=hello&bars=64&version=v2`);
    expect(page.entries).toHaveLength(1);
  });

  it('keeps the version and piece on reroll', async () => {
    const page = await open(`http://localhost/?piece=${RIVER}&seed=a&version=v1`, frozen);
    page.announce('tamirobe', 32);
    expect(page.url().search).toBe(`?piece=${RIVER}&seed=tamirobe&version=v1&bars=32`);
    expect(page.entries).toHaveLength(1);
  });

  it('removes a version parameter for an unfrozen piece', async () => {
    const page = await open('http://localhost/?piece=placeholder&seed=a&bars=16');
    page.announce('b', 16);
    expect(page.url().searchParams.has('version')).toBe(false);
  });

  it('a copied link keeps playing its version after the next freeze', async () => {
    const before = await open(`http://localhost/?piece=${RIVER}&seed=hello`, frozen);
    const copied = before.url().href;
    const later = await open(copied, {
      ...frozen,
      [`/pieces/${RIVER}/versions.json`]: list([V1, 'v1'], [V2, 'v2'], [V3, 'v3']),
      [`/stems/${V3.hex}.json`]: V3.text,
    });
    expect(later.attrs.get('src')).toBe(`/stems/${V2.hex}.json`);
    expect(later.url().href).toBe(copied);
  });
});

describe('player page with a piece that has tracks', () => {
  const frozen = {
    [`/pieces/${RIVER}/versions.json`]: list([V1, 'v1'], [V2, 'v2']),
    [`/stems/${V1.hex}.json`]: V1.text,
    [`/stems/${V2.hex}.json`]: V2.text,
  };
  const withTracks = {
    ...frozen,
    [`/pieces/${RIVER}/release.json`]: JSON.stringify({
      tracks: [
        {
          id: 'first-light',
          title: 'First Light',
          version: `sha256:${V1.hex}`,
          seed: 'ox-bow',
          bars: 40,
          audio: `sha256:${'c'.repeat(64)}`,
          frames: 6_432_000,
        },
      ],
    }),
    [`/pieces/${RIVER}/tracks/first-light/`]: '<!doctype html>',
  };
  const href = `http://localhost/?piece=${RIVER}&version=v1&seed=ox-bow&bars=40`;

  it('behaves exactly as it does for a piece without tracks', async () => {
    const plain = await open(href, frozen);
    const tracked = await open(href, withTracks);
    expect(Object.fromEntries(tracked.attrs)).toEqual(Object.fromEntries(plain.attrs));
    expect(tracked.attrs.get('src')).toBe(`/stems/${V1.hex}.json`);
    expect(tracked.entries).toEqual(plain.entries);
    expect(tracked.fetched).toEqual(plain.fetched);
    expect(tracked.errors).toEqual([]);
    expect(tracked.titles).toEqual(plain.titles);
    expect(tracked.fetched.some((u) => u.includes('release.json') || u.includes('/tracks/'))).toBe(
      false,
    );
  });
});
