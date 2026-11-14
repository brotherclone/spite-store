import {
  checkManifest,
  decodeWav,
  planRenderPartial,
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

/**
 * A performance whose stems may still be arriving. `plan`, `pending`, `horizon` and `final` are
 * the engine's partial plan for the stems in `stems`, and are replaced as each one arrives.
 */
export interface Performance {
  manifest: Manifest;
  seed: string;
  bars: number;
  events: TraceEvent[];
  visits: Visit[];
  endBar: number;
  plan: RenderPlan;
  /** Indexes of the voices whose stem hasn't arrived. */
  pending: number[];
  /** Frames before this one can be played exactly. */
  horizon: number;
  /** Every stem is in: the plan and its length are final. */
  final: boolean;
  /** The stems that have arrived, by hash. */
  stems: Map<string, Stem>;
  /** Every stem the performance needs, in the order they are fetched (first use, then hash). */
  needed: string[];
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

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
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

export interface StreamOptions extends LoadOptions {
  /** How many stem requests run at once (default 4). */
  width?: number;
  /** Aborts the outstanding requests (a new load replaces this one). */
  signal?: AbortSignal;
  /** A stem arrived and the performance's plan was updated. */
  onStem?: (hash: string) => void;
  /** A stem failed: missing, wrong hash or undecodable. */
  onFailure?: (hash: string, message: string) => void;
}

/** Recomputes the performance's partial plan from the stems it has. */
function replan(perf: Performance): void {
  const partial = planRenderPartial(perf.manifest, perf.events, perf.endBar, perf.stems);
  perf.plan = partial.plan;
  perf.pending = partial.pending;
  perf.horizon = partial.horizon;
  perf.final = partial.final;
}

/**
 * Realizes a performance and starts fetching, verifying (sha256) and decoding the stems it uses,
 * a few at a time, in the order the performance first uses them. Returns the performance at once,
 * planned with whatever is already cached, and updates it as stems arrive. `done` resolves with
 * every failure once each stem has arrived or failed, or with nothing after an abort.
 */
export function streamPerformance(options: StreamOptions): {
  perf: Performance;
  done: Promise<string[]>;
} {
  const { manifest, seed, bars, cache } = options;
  const fetchImpl = options.fetch ?? fetch;
  const { events, endBar, visits } = realizeTimeline(manifest, seed, { durationBars: bars });
  const firstBar = new Map<string, number>();
  for (const e of events) if (!firstBar.has(e.clipHash)) firstBar.set(e.clipHash, e.bar);
  const needed = [...firstBar.keys()].sort(
    (a, b) => firstBar.get(a)! - firstBar.get(b)! || (a < b ? -1 : a > b ? 1 : 0),
  );
  const perf: Performance = {
    manifest,
    seed,
    bars,
    events,
    visits,
    endBar,
    plan: { totalFrames: 0, voices: [] },
    pending: [],
    horizon: 0,
    final: false,
    stems: new Map(needed.filter((h) => cache.has(h)).map((h) => [h, cache.get(h)!])),
    needed,
  };
  replan(perf);
  options.onProgress?.(perf.stems.size, needed.length);

  const clipIds = (hash: string) =>
    Object.keys(manifest.clips)
      .filter((id) => manifest.clips[id]!.hash === hash)
      .sort()
      .join(', ');
  const queue = needed.filter((h) => !perf.stems.has(h));
  const failures: string[] = [];
  const aborted = () => options.signal?.aborted === true;

  const fetchOne = async (hash: string): Promise<void> => {
    const hex = hash.slice('sha256:'.length);
    const url = new URL(`${hex}.wav`, options.stemsBase).href;
    const fail = (reason: string) => {
      if (aborted()) return;
      const message = `stem ${clipIds(hash)}  ${hash}  ${reason}`;
      failures.push(message);
      options.onFailure?.(hash, message);
    };
    try {
      const response = await fetchImpl(url, { signal: options.signal });
      if (!response.ok) return fail(`missing (HTTP ${response.status} for ${url})`);
      const bytes = await response.arrayBuffer();
      if ((await sha256Hex(bytes)) !== hex) return fail('content does not match its hash');
      const stem = decodeWav(new Uint8Array(bytes), hash);
      if (aborted()) return;
      cache.set(hash, stem);
      perf.stems.set(hash, stem);
      replan(perf);
      options.onProgress?.(perf.stems.size, needed.length);
      options.onStem?.(hash);
    } catch (error) {
      fail((error as Error).message);
    }
  };

  const worker = async (): Promise<void> => {
    while (queue.length > 0 && !aborted()) await fetchOne(queue.shift()!);
  };
  const width = Math.max(1, options.width ?? 4);
  const done = Promise.all(Array.from({ length: Math.min(width, queue.length) }, worker)).then(
    () => (aborted() ? [] : failures),
  );
  return { perf, done };
}

/** Streams a performance and waits for every stem. All stem problems go into one LoadError. */
export async function loadPerformance(options: LoadOptions): Promise<Performance> {
  const { perf, done } = streamPerformance(options);
  const problems = await done;
  if (problems.length > 0) throw new LoadError(problems);
  return perf;
}
