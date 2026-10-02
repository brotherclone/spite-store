import {
  checkManifest,
  decodeWav,
  planRender,
  realizeTimeline,
  type Manifest,
  type RenderPlan,
  type Stem,
  type TraceEvent,
  type Visit,
} from '@spite-store/engine';

/** A load failure with one or more human-readable messages. */
export class LoadError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join('\n'));
  }
}

export interface Performance {
  manifest: Manifest;
  seed: string;
  bars: number;
  events: TraceEvent[];
  visits: Visit[];
  endBar: number;
  plan: RenderPlan;
  stems: Map<string, Stem>;
}

type Fetch = typeof fetch;

export async function loadManifest(src: string, fetchImpl: Fetch = fetch): Promise<Manifest> {
  let response: Response;
  try {
    response = await fetchImpl(src);
  } catch (error) {
    throw new LoadError([`could not fetch manifest ${src}: ${(error as Error).message}`]);
  }
  if (!response.ok)
    throw new LoadError([`could not fetch manifest ${src}: HTTP ${response.status}`]);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new LoadError([`manifest ${src} is not valid JSON`]);
  }
  const errors = checkManifest(data);
  if (errors.length > 0)
    throw new LoadError(errors.map((e) => `${e.pointer || '(root)'}  ${e.message}`));
  return data as Manifest;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of digest) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export interface LoadOptions {
  manifest: Manifest;
  seed: string;
  bars: number;
  /** Base URL that `<hex>.wav` is resolved against. */
  stemsBase: string;
  /** Decoded stems by hash, shared across loads of one player. */
  cache: Map<string, Stem>;
  fetch?: Fetch;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Realizes a performance, then fetches, verifies (sha256) and decodes only the stems it uses.
 * All stem problems are collected into one LoadError naming each hash and its clip ids.
 */
export async function loadPerformance(options: LoadOptions): Promise<Performance> {
  const { manifest, seed, bars, cache } = options;
  const fetchImpl = options.fetch ?? fetch;
  const { events, endBar, visits } = realizeTimeline(manifest, seed, { durationBars: bars });
  const needed = [...new Set(events.map((e) => e.clipHash))].sort();
  let loaded = needed.filter((h) => cache.has(h)).length;
  options.onProgress?.(loaded, needed.length);

  const clipIds = (hash: string) =>
    Object.keys(manifest.clips)
      .filter((id) => manifest.clips[id]!.hash === hash)
      .sort()
      .join(', ');

  const results = await Promise.all(
    needed.map(async (hash): Promise<string | null> => {
      if (cache.has(hash)) return null;
      const hex = hash.slice('sha256:'.length);
      const url = new URL(`${hex}.wav`, options.stemsBase).href;
      const fail = (reason: string) => `stem ${clipIds(hash)}  ${hash}  ${reason}`;
      try {
        const response = await fetchImpl(url);
        if (!response.ok) return fail(`missing (HTTP ${response.status} for ${url})`);
        const bytes = await response.arrayBuffer();
        if ((await sha256Hex(bytes)) !== hex) return fail('content does not match its hash');
        cache.set(hash, decodeWav(new Uint8Array(bytes), hash));
        options.onProgress?.(++loaded, needed.length);
        return null;
      } catch (error) {
        return fail((error as Error).message);
      }
    }),
  );
  const problems = results.filter((r): r is string => r !== null);
  if (problems.length > 0) throw new LoadError(problems);

  const stems = new Map(needed.map((h) => [h, cache.get(h)!]));
  return {
    manifest,
    seed,
    bars,
    events,
    visits,
    endBar,
    plan: planRender(manifest, events, endBar, stems),
    stems,
  };
}
