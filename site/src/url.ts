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

/** The default piece a build was configured with (`VITE_DEFAULT_PIECE`), or the placeholder. */
export function defaultPiece(configured: string | undefined): string {
  return configured !== undefined && PIECE_ID.test(configured) ? configured : DEFAULT_PIECE;
}

/** The piece `?piece=` selects, or `fallbackPiece` when absent or not a valid id. */
export function selectedPiece(href: string, fallbackPiece = DEFAULT_PIECE): string {
  const piece = new URL(href).searchParams.get('piece');
  return piece !== null && PIECE_ID.test(piece) ? piece : fallbackPiece;
}

const HEX = /^[0-9a-f]{64}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const LABEL = /^[a-z0-9][a-z0-9._-]{0,31}$/;

interface VersionEntry {
  hex: string;
  label: string;
}

/**
 * The shape check of a piece's `versions.json` (the CLI's `parseVersions` is the full one):
 * `{ "versions": [{ "hash": "sha256:<hex>", "label": "<label>" }, ...] }`, no other fields, no
 * repeated hash or label, no reserved label. Returns the entries in order, or the first problem.
 */
export function parseVersionList(text: string): VersionEntry[] | string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return 'not valid JSON';
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return 'not an object';
  const extra = Object.keys(data).find((k) => k !== 'versions');
  if (extra !== undefined) return `unknown field "${extra}"`;
  const list = (data as { versions?: unknown }).versions;
  if (!Array.isArray(list)) return '"versions" is not a list';
  const entries: VersionEntry[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return 'bad entry';
    const field = Object.keys(item).find((k) => k !== 'hash' && k !== 'label');
    if (field !== undefined) return `unknown field "${field}"`;
    const { hash, label } = item as { hash?: unknown; label?: unknown };
    if (typeof hash !== 'string' || !HASH.test(hash)) return `bad hash ${String(hash)}`;
    if (typeof label !== 'string' || !LABEL.test(label) || label === 'working' || HEX.test(label))
      return `bad label ${String(label)}`;
    const hex = hash.slice('sha256:'.length);
    if (entries.some((e) => e.hex === hex)) return `repeated hash ${hash}`;
    if (entries.some((e) => e.label === label)) return `repeated label "${label}"`;
    entries.push({ hex, label });
  }
  return entries;
}

export type Resolution =
  | { kind: 'frozen'; hex: string; label?: string }
  | { kind: 'working'; explicit: boolean }
  | { kind: 'error'; message: string };

/**
 * Resolves `?version=` for a piece against its `versions.json` text (null when the piece has
 * none): a recorded label to that version; 64 hex digits to that hash, recorded or not; `working`
 * to the working manifest; nothing to the latest version, or the working manifest when unfrozen.
 * An unknown label is an error, never another version.
 */
export function resolveVersion(
  piece: string,
  ref: string | null,
  versionsText: string | null,
): Resolution {
  const list = versionsText === null ? [] : parseVersionList(versionsText);
  if (ref !== null && HEX.test(ref)) {
    const label = typeof list === 'string' ? undefined : list.find((e) => e.hex === ref)?.label;
    return label === undefined ? { kind: 'frozen', hex: ref } : { kind: 'frozen', hex: ref, label };
  }
  if (ref === 'working') return { kind: 'working', explicit: true };
  if (typeof list === 'string') {
    return { kind: 'error', message: `${piece}: its version list is invalid (${list})` };
  }
  if (ref === null) {
    const latest = list.at(-1);
    return latest ? { kind: 'frozen', ...latest } : { kind: 'working', explicit: false };
  }
  const entry = list.find((e) => e.label === ref);
  if (!entry) return { kind: 'error', message: `${piece} has no version "${ref}"` };
  return { kind: 'frozen', ...entry };
}

/** What the page loads: the manifest URL, the `version` to write in the URL, and the title. */
export type Loaded =
  | { ok: true; piece: string; src: string; version: string | null; title?: string }
  | { ok: false; message: string };

export interface LoadDeps {
  fetch: (
    url: string,
  ) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** The lowercase hex sha256 of `bytes`. */
  digest: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
}

/** The sha256 of `bytes` with Web Crypto, as lowercase hex. */
export async function webDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

const titleOf = (data: unknown): string | undefined => {
  const title = (data as { title?: unknown } | null)?.title;
  return typeof title === 'string' && title !== '' ? title : undefined;
};

/**
 * Decides which manifest the page plays. For a frozen version it fetches `/stems/<hex>.json` and
 * checks its sha256 and its `id` before handing it over, so a link that names a version plays
 * exactly that version or nothing.
 */
export async function loadPiece(
  href: string,
  fallbackPiece: string,
  deps: LoadDeps,
): Promise<Loaded> {
  const piece = selectedPiece(href, fallbackPiece);
  const ref = new URL(href).searchParams.get('version') || null;
  let versionsText: string | null = null;
  if (ref !== 'working') {
    try {
      const response = await deps.fetch(`/pieces/${piece}/versions.json`);
      if (response.ok) versionsText = new TextDecoder().decode(await response.arrayBuffer());
      else if (response.status !== 404 && !(ref !== null && HEX.test(ref))) {
        return {
          ok: false,
          message: `${piece}: couldn't load its versions (HTTP ${response.status})`,
        };
      }
    } catch (error) {
      // A hash names its version without the list; the list would only supply a label.
      if (ref === null || !HEX.test(ref)) {
        return { ok: false, message: `${piece}: couldn't load its versions (${String(error)})` };
      }
    }
  }
  const resolved = resolveVersion(piece, ref, versionsText);
  if (resolved.kind === 'error') return { ok: false, message: resolved.message };
  if (resolved.kind === 'working') {
    return {
      ok: true,
      piece,
      src: `/pieces/${piece}/manifest.json`,
      version: resolved.explicit ? 'working' : null,
    };
  }

  const { hex } = resolved;
  const version = resolved.label ?? hex;
  const failed = (why: string): Loaded => ({
    ok: false,
    message: `${piece} version ${version}: ${why}`,
  });
  const src = `/stems/${hex}.json`;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const response = await deps.fetch(src);
    if (!response.ok) return failed(`couldn't load ${src} (HTTP ${response.status})`);
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return failed(`couldn't load ${src} (${String(error)})`);
  }
  if ((await deps.digest(bytes)) !== hex) return failed(`${src} doesn't match its hash`);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return failed(`${src} is not valid JSON`);
  }
  const id = (data as { id?: unknown } | null)?.id;
  if (id !== piece) return failed(`${src} is a version of ${String(id)}, not ${piece}`);
  const title = titleOf(data);
  return title === undefined
    ? { ok: true, piece, src, version }
    : { ok: true, piece, src, version, title };
}

/** The manifest's title from its URL, or undefined; for working manifests, whose bytes aren't verified. */
export async function fetchTitle(
  src: string,
  deps: Pick<LoadDeps, 'fetch'>,
): Promise<string | undefined> {
  try {
    const response = await deps.fetch(src);
    if (!response.ok) return undefined;
    return titleOf(JSON.parse(new TextDecoder().decode(await response.arrayBuffer())));
  } catch {
    return undefined;
  }
}

/**
 * Writes `version` into a URL's query: set to `version`, or removed when null (an unfrozen piece).
 */
function withVersion(url: URL, version: string | null): void {
  if (version === null) url.searchParams.delete('version');
  else url.searchParams.set('version', version);
}

/**
 * Passes the chosen manifest and `?seed=` and `?bars=` to the player. Without a seed the player
 * picks a random one. The player batches attribute changes, so this all becomes a single load.
 */
export function applyQuery(player: PlayerLike, href: string, src: string): void {
  const params = new URL(href).searchParams;
  player.setAttribute('src', src);
  const seed = params.get('seed');
  const bars = params.get('bars');
  if (seed) player.setAttribute('seed', seed);
  player.setAttribute('bars', bars ?? '64');
}

/**
 * Names the version being played in the page URL as soon as it is known (with `bars`, so an
 * unversioned link becomes a complete permalink), without reloading or adding history.
 */
export function writeVersion(
  history: HistoryLike,
  location: { href: string },
  version: string | null,
): void {
  const url = new URL(location.href);
  if (!url.searchParams.has('bars')) url.searchParams.set('bars', '64');
  withVersion(url, version);
  if (url.href !== location.href) history.replaceState(null, '', url.href);
}

/** Keeps the page URL in sync with the player without adding history entries. */
export function followPlayer(
  player: PlayerLike,
  history: HistoryLike,
  location: { href: string },
  version: string | null = null,
): void {
  player.addEventListener('seedchange', (event) => {
    const { seed, bars } = (event as CustomEvent<{ seed: string; bars: number }>).detail;
    const url = new URL(location.href);
    url.searchParams.set('seed', seed);
    url.searchParams.set('bars', String(bars));
    withVersion(url, version);
    history.replaceState(null, '', url.href);
  });
}

export interface PageDeps extends LoadDeps {
  player: PlayerLike;
  history: HistoryLike;
  location: { href: string };
  showError(message: string): void;
  setTitle(title: string): void;
  /** Defines `<spite-player>`, which starts it loading. */
  loadPlayer(): Promise<unknown>;
}

/**
 * Starts the page: resolves and verifies the version, names it in the URL, then gives the player
 * its manifest, seed and bars and only then defines the element, so the player never starts on a
 * manifest that wasn't chosen. On an error the page shows it and the player gets nothing.
 */
export async function startPage(fallbackPiece: string, deps: PageDeps): Promise<Loaded> {
  const loaded = await loadPiece(deps.location.href, fallbackPiece, deps);
  if (!loaded.ok) {
    deps.showError(loaded.message);
    return loaded;
  }
  writeVersion(deps.history, deps.location, loaded.version);
  followPlayer(deps.player, deps.history, deps.location, loaded.version);
  applyQuery(deps.player, deps.location.href, loaded.src);
  await deps.loadPlayer();
  const title = loaded.title ?? (await fetchTitle(loaded.src, deps));
  if (title !== undefined) deps.setTitle(title);
  return loaded;
}
