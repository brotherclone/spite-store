import {
  barFrame,
  encodeWav16,
  planRender,
  realizeForRender,
  type Manifest,
} from '@spite-store/engine';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import '../src/index.js';
import type { SpitePlayer } from '../src/index.js';
import { layoutLanes } from '../src/lanes.js';
import {
  placeholder,
  placeholderStemFiles,
  placeholderStems,
  sha256Hex,
  workletUrl,
} from './helpers.js';

const MANIFEST = '/pieces/placeholder/manifest.json';
const SEED = '42';
const BARS = 16;
const { events, endBar } = realizeForRender(placeholder, SEED, { durationBars: BARS });

/** The first bar each stem sounds at, and the stems in the order the player should fetch them. */
const firstBar = new Map<string, number>();
for (const e of events) if (!firstBar.has(e.clipHash)) firstBar.set(e.clipHash, e.bar);
const order = [...firstBar.keys()].sort(
  (a, b) => firstBar.get(a)! - firstBar.get(b)! || (a < b ? -1 : a > b ? 1 : 0),
);
/** The first stem not used at bar 0, and the bar it starts at. */
const late = order.find((h) => firstBar.get(h)! > 0)!;
const lateBar = firstBar.get(late)!;
const lateFrame = barFrame(placeholder, lateBar);

let files: Map<string, Uint8Array>;
let fullTotal: number;
let recording: Uint8Array;
let recordingHash: string;
const created: SpitePlayer[] = [];

beforeAll(async () => {
  files = await placeholderStemFiles();
  fullTotal = planRender(placeholder, events, endBar, await placeholderStems()).totalFrames;
  const tone = Float32Array.from({ length: 9600 }, (_, i) => Math.sin(i / 20) * 0.05);
  recording = encodeWav16([tone, tone]);
  recordingHash = `sha256:${await sha256Hex(recording)}`;
});

afterEach(() => {
  for (const p of created.splice(0)) p.remove();
});

/**
 * A fake server whose stem responses can be held back. `hold` keeps every listed hash waiting
 * until `release(hash)` or `fail(hash)`; the rest answer at once. Records the order stem requests
 * start in, and each request's abort signal.
 */
function server(options: { hold?: Iterable<string>; manifest?: Manifest } = {}) {
  const manifest = options.manifest ?? placeholder;
  const held = new Map<string, (outcome: 'ok' | 'corrupt') => void>();
  const waiting = new Map<string, Promise<'ok' | 'corrupt'>>();
  for (const h of options.hold ?? []) {
    waiting.set(h, new Promise((resolve) => held.set(h, resolve)));
  }
  const requests: string[] = [];
  const signals: AbortSignal[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.pathname === MANIFEST) return new Response(JSON.stringify(manifest));
    const wav = /^\/stems\/([0-9a-f]{64})\.wav$/.exec(url.pathname);
    if (wav) {
      const hash = `sha256:${wav[1]}`;
      requests.push(hash);
      if (init?.signal) signals.push(init.signal);
      const outcome = (await waiting.get(hash)) ?? 'ok';
      init?.signal?.throwIfAborted();
      const bytes = files.get(hash)!;
      return new Response(outcome === 'corrupt' ? bytes.slice(0, -2) : bytes);
    }
    const mp3 = /^\/stems\/([0-9a-f]{64})\.mp3$/.exec(url.pathname);
    if (mp3 && `sha256:${mp3[1]}` === recordingHash) return new Response(recording);
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return {
    fetch: fetchImpl,
    requests,
    signals,
    release: (hash: string) => held.get(hash)!('ok'),
    fail: (hash: string) => held.get(hash)!('corrupt'),
  };
}

function player(attrs: Record<string, string>, srv: ReturnType<typeof server>, width = 4) {
  const el = document.createElement('spite-player') as SpitePlayer;
  el.fetchImpl = srv.fetch;
  el.workletUrl = workletUrl;
  el.queueWidth = width;
  el.setAttribute('stems', '/stems/');
  for (const [k, v] of Object.entries({ src: MANIFEST, seed: SEED, bars: String(BARS), ...attrs }))
    el.setAttribute(k, v);
  created.push(el);
  document.body.append(el);
  return el;
}

type Name = 'ready' | 'loaded' | 'error' | 'ended' | 'fallback' | 'waiting' | 'playing' | 'skipped';
const next = (el: SpitePlayer, type: Name) =>
  new Promise<CustomEvent>((resolve) =>
    el.addEventListener(type, (e) => resolve(e as CustomEvent), { once: true }),
  );
function record(el: SpitePlayer, ...types: Name[]) {
  const seen: { type: Name; detail: unknown }[] = [];
  for (const type of types)
    el.addEventListener(type, (e) => seen.push({ type, detail: (e as CustomEvent).detail }));
  return seen;
}
const part = <T extends HTMLElement = HTMLElement>(el: SpitePlayer, name: string) =>
  el.shadowRoot!.querySelector<T>(`[part='${name}']`)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seeks to a little before `frame` and starts playing, so playback reaches it within a second. */
async function playFrom(el: SpitePlayer, frame: number) {
  await el.seek(Math.max(0, frame - 24_000));
  await userEvent.click(part(el, 'play'));
}

describe('streaming loads', () => {
  it('enables play before every stem is in', async () => {
    const srv = server({ hold: order.filter((h) => firstBar.get(h)! > 0) });
    const el = player({}, srv);
    const seen = record(el, 'ready', 'loaded');
    await next(el, 'ready');
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(false);
    const bar0 = order.filter((h) => firstBar.get(h) === 0).length;
    expect(part(el, 'status').textContent).toContain(`stems ${bar0} / ${order.length}`);
    expect(seen.map((e) => e.type)).toEqual(['ready']);
  });

  it('requests stems in order of first use, ties by hash', async () => {
    const srv = server();
    const el = player({}, srv, 1);
    await next(el, 'loaded');
    expect(srv.requests).toEqual(order);
  });

  it('aborts outstanding requests when a new performance loads', async () => {
    const srv = server({ hold: order });
    const el = player({}, srv);
    await sleep(50);
    expect(srv.signals.length).toBeGreaterThan(0);
    el.setAttribute('seed', 'another');
    await sleep(50);
    expect(srv.signals.slice(0, 4).every((s) => s.aborted)).toBe(true);
  });

  it('makes the length final once every stem is in', async () => {
    const srv = server({ hold: [late] });
    const el = player({}, srv);
    await next(el, 'ready');
    expect(Number(part<HTMLInputElement>(el, 'scrub').max)).toBe(barFrame(placeholder, endBar));
    const loaded = next(el, 'loaded');
    srv.release(late);
    await loaded;
    expect(Number(part<HTMLInputElement>(el, 'scrub').max)).toBe(fullTotal);
  });

  it('draws a held-back clip as pending, then with its tail once it arrives', async () => {
    const srv = server({ hold: [late] });
    const el = player({}, srv);
    await next(el, 'ready');
    const index = el.performance!.plan.voices.findIndex((v) => v.clipHash === late);
    const pending = layoutLanes(el.performance!).blocks[index]!;
    expect(pending.state).toBe('pending');
    const clip = Object.values(placeholder.clips).find((c) => c.hash === late)!;
    expect(pending.bodyEnd).toBeLessThanOrEqual(barFrame(placeholder, lateBar + clip.lengthBars));
    expect(pending.end).toBe(pending.bodyEnd);
    const loaded = next(el, 'loaded');
    srv.release(late);
    await loaded;
    const ready = layoutLanes(el.performance!).blocks[index]!;
    expect(ready.state).toBe('ready');
    expect(ready.end).toBe(el.performance!.plan.voices[index]!.end);
  });
});

describe('late stems under wait', () => {
  it('holds at the late clip and resumes from exactly there', async () => {
    const srv = server({ hold: [late] });
    const el = player({}, srv);
    await next(el, 'ready');
    const waiting = next(el, 'waiting');
    await playFrom(el, lateFrame);
    expect((await waiting).detail.frame).toBe(lateFrame);
    await sleep(300);
    expect(el.position).toBe(lateFrame);
    expect(part(el, 'status').textContent).toContain('Buffering');
    const playing = next(el, 'playing');
    srv.release(late);
    expect((await playing).detail.frame).toBe(lateFrame);
    await sleep(300);
    expect(el.position).toBeGreaterThan(lateFrame);
  });

  it('holds at a sought frame until the stems before it arrive', async () => {
    const held = order.filter((h) => firstBar.get(h)! >= lateBar);
    const srv = server({ hold: held });
    const el = player({}, srv, 1);
    await next(el, 'ready');
    const target = barFrame(placeholder, endBar - 1);
    await el.seek(target);
    const waiting = next(el, 'waiting');
    await userEvent.click(part(el, 'play'));
    expect((await waiting).detail.frame).toBe(target);
    // Stems first used earlier are asked for before later ones.
    expect(srv.requests).toEqual(order.slice(0, srv.requests.length));
    const playing = next(el, 'playing');
    for (const h of held) srv.release(h);
    expect((await playing).detail.frame).toBe(target);
  });

  it('treats an unknown late value as wait', async () => {
    const srv = server({ hold: [late] });
    const el = player({ late: 'sometimes' }, srv);
    await next(el, 'ready');
    const waiting = next(el, 'waiting');
    await playFrom(el, lateFrame);
    expect((await waiting).detail.frame).toBe(lateFrame);
    srv.release(late);
  });

  it('plays to the end with stems arriving during playback, firing ended once', async () => {
    const lastHash = order.at(-1)!;
    const srv = server({ hold: [lastHash] });
    const el = player({}, srv);
    await next(el, 'ready');
    let ended = 0;
    el.addEventListener('ended', () => ended++);
    const done = next(el, 'ended');
    await playFrom(el, fullTotal - 24_000);
    srv.release(lastHash);
    await done;
    await sleep(100);
    expect(ended).toBe(1);
    expect(el.position).toBe(fullTotal);
    expect(part(el, 'play').textContent).toBe('Play');
  });
});

describe('late stems under skip', () => {
  it('leaves the late clip out, reports it and keeps time going', async () => {
    const srv = server({ hold: [late] });
    const el = player({ late: 'skip' }, srv);
    await next(el, 'ready');
    const skipped = next(el, 'skipped');
    await playFrom(el, lateFrame);
    const first = events.find((e) => e.clipHash === late)!;
    expect((await skipped).detail).toEqual({ slot: first.slot, clipHash: late, bar: lateBar });
    await sleep(300);
    expect(el.position).toBeGreaterThan(lateFrame);
    expect(part(el, 'status').textContent).toMatch(/\d+ clips? skipped \(arrived late\)/);
    const index = el.performance!.plan.voices.findIndex((v) => v.clipHash === late);
    srv.release(late);
    await sleep(100);
    await el.pause();
    const layout = layoutLanes(el.performance!, new Set([index]));
    expect(layout.blocks[index]!.state).toBe('skipped');
  });

  it('switches mode during playback without reloading or refetching', async () => {
    const srv = server();
    const el = player({}, srv);
    await next(el, 'loaded');
    const requests = srv.requests.length;
    const seen = record(el, 'ready', 'loaded');
    await userEvent.click(part(el, 'play'));
    await sleep(200);
    el.setAttribute('late', 'skip');
    await sleep(200);
    expect(el.isPlaying).toBe(true);
    expect(seen).toEqual([]);
    expect(srv.requests.length).toBe(requests);
  });

  it('the control sets the attribute', async () => {
    const el = player({}, server());
    await next(el, 'ready');
    const control = part<HTMLInputElement>(el, 'late');
    expect(control.checked).toBe(false);
    await userEvent.click(control);
    expect(el.getAttribute('late')).toBe('skip');
    await userEvent.click(control);
    expect(el.getAttribute('late')).toBe('wait');
  });
});

describe('a stem failing during playback', () => {
  const withFallback: Manifest = {
    ...placeholder,
    fallback: { hash: '', type: 'audio/mpeg', seed: 'spite-store', bars: 16 },
  };

  it('plays up to the failed stem, then falls back paused at the start', async () => {
    const manifest = {
      ...withFallback,
      fallback: { ...withFallback.fallback!, hash: recordingHash },
    };
    const srv = server({ hold: [late], manifest });
    const el = player({}, srv);
    await next(el, 'ready');
    const seen = record(el, 'error', 'fallback');
    const fallback = next(el, 'fallback');
    await playFrom(el, lateFrame);
    srv.fail(late);
    const event = await fallback;
    expect(seen[0]!.type).toBe('error');
    expect((seen[0]!.detail as { messages: string[] }).messages.join('\n')).toContain(late);
    expect(event.detail.reason).toBe('stems');
    await sleep(100);
    expect(el.fallbackReason).toBe('stems');
    expect(el.isPlaying).toBe(false);
    expect(el.position).toBe(0);
  });

  it('without a fallback, stops at the failed stem and disables play', async () => {
    const srv = server({ hold: [late] });
    const el = player({}, srv);
    await next(el, 'ready');
    const error = next(el, 'error');
    await playFrom(el, lateFrame);
    for (let i = 0; i < 100 && !el.isPlaying; i++) await sleep(20);
    expect(el.isPlaying).toBe(true);
    srv.fail(late);
    await error;
    for (let i = 0; i < 150 && el.isPlaying; i++) await sleep(20);
    expect(el.isPlaying).toBe(false);
    expect(el.position).toBe(lateFrame);
    expect(part(el, 'status').textContent).toContain(late);
    expect(part(el, 'status').classList.contains('error')).toBe(true);
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(true);
  });
});
