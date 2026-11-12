import { encodeWav16, realize, type Manifest } from '@spite-store/engine';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import invalidManifest from '../../../schema/examples/invalid/dangling-transition.json';
import '../src/index.js';
import type { SpitePlayer } from '../src/index.js';
import { placeholder, placeholderStemFiles, sha256Hex, workletUrl } from './helpers.js';

const MANIFEST = '/pieces/placeholder/manifest.json';
let stems: Map<string, Uint8Array>;
/** A short real recording. Browsers sniff it as WAV, so it stands in for the MP3 in tests. */
let recording: Uint8Array;
let recordingHash: string;
let withFallback: Manifest;
const created: SpitePlayer[] = [];

beforeAll(async () => {
  stems = await placeholderStemFiles();
  const frames = 9600;
  const tone = Float32Array.from({ length: frames }, (_, i) => Math.sin(i / 20) * 0.05);
  recording = encodeWav16([tone, tone]);
  recordingHash = `sha256:${await sha256Hex(recording)}`;
  withFallback = {
    ...placeholder,
    fallback: { hash: recordingHash, type: 'audio/mpeg', seed: 'spite-store', bars: 16 },
  };
});

afterEach(() => {
  for (const p of created.splice(0)) p.remove();
});

/** A fake server for manifests, stems and fallback recordings, recording every request. */
function server(
  options: {
    manifest?: unknown;
    corruptStem?: string;
    fallbackBytes?: Uint8Array | null;
  } = {},
) {
  const manifest = options.manifest ?? withFallback;
  const wavRequests: string[] = [];
  const mp3Requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.pathname === MANIFEST) return new Response(JSON.stringify(manifest));
    const wav = /^\/stems\/([0-9a-f]{64})\.wav$/.exec(url.pathname);
    if (wav) {
      wavRequests.push(wav[1]!);
      const hash = `sha256:${wav[1]}`;
      const bytes = stems.get(hash);
      if (!bytes) return new Response('not found', { status: 404 });
      return new Response(hash === options.corruptStem ? bytes.slice(0, -2) : bytes);
    }
    const mp3 = /^\/stems\/([0-9a-f]{64})\.mp3$/.exec(url.pathname);
    if (mp3) {
      mp3Requests.push(mp3[1]!);
      const bytes = options.fallbackBytes === undefined ? recording : options.fallbackBytes;
      if (bytes === null || `sha256:${mp3[1]}` !== recordingHash)
        return new Response('not found', { status: 404 });
      return new Response(bytes);
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchImpl, wavRequests, mp3Requests };
}

function player(attrs: Record<string, string>, srv = server()): SpitePlayer {
  const el = document.createElement('spite-player') as SpitePlayer;
  el.fetchImpl = srv.fetch;
  el.workletUrl = workletUrl;
  el.setAttribute('stems', '/stems/');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  created.push(el);
  document.body.append(el);
  return el;
}

type Name = 'ready' | 'error' | 'ended' | 'fallback';
/** Records events of the given types in order, with their details. */
function record(el: SpitePlayer, ...types: Name[]) {
  const seen: { type: Name; detail: unknown }[] = [];
  for (const type of types) {
    el.addEventListener(type, (e) => seen.push({ type, detail: (e as CustomEvent).detail }));
  }
  return seen;
}

const once = (el: SpitePlayer, type: Name) =>
  new Promise<CustomEvent>((resolve) =>
    el.addEventListener(type, (e) => resolve(e as CustomEvent), { once: true }),
  );

const part = <T extends HTMLElement = HTMLElement>(el: SpitePlayer, name: string) =>
  el.shadowRoot!.querySelector<T>(`[part='${name}']`)!;

/** Waits until the recording's length is known (the scrub bar is enabled). */
async function sized(el: SpitePlayer) {
  for (let i = 0; i < 200 && part<HTMLInputElement>(el, 'scrub').disabled; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('when the player falls back', () => {
  it('is forced by the fallback attribute, without fetching any stem', async () => {
    const srv = server();
    const el = player({ src: MANIFEST, seed: '42', bars: '16', fallback: '' }, srv);
    const seen = record(el, 'fallback', 'ready', 'error');
    await once(el, 'ready');
    expect(seen.map((e) => e.type)).toEqual(['fallback', 'ready']);
    expect(seen[0]!.detail).toEqual({ reason: 'forced', seed: 'spite-store', bars: 16 });
    expect(el.fallbackReason).toBe('forced');
    expect(srv.wavRequests).toEqual([]);
    expect(srv.mp3Requests).toEqual([recordingHash.slice(7)]);
  });

  it('falls back when AudioWorkletNode is missing, without fetching any stem', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'AudioWorkletNode')!;
    delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
    try {
      const srv = server();
      const el = player({ src: MANIFEST, seed: '42', bars: '16' }, srv);
      const fallback = once(el, 'fallback');
      await once(el, 'ready');
      expect((await fallback).detail.reason).toBe('unsupported');
      expect(srv.wavRequests).toEqual([]);
    } finally {
      Object.defineProperty(globalThis, 'AudioWorkletNode', saved);
    }
  });

  it('falls back and plays when the worklet fails to start', async () => {
    const el = player({ src: MANIFEST, seed: '42', bars: '16' });
    el.workletUrl = new URL('/no-such-worklet.js', location.href).href;
    await once(el, 'ready');
    expect(el.fallbackReason).toBeNull();
    const fallback = once(el, 'fallback');
    await userEvent.click(part(el, 'play'));
    expect((await fallback).detail.reason).toBe('worklet');
    for (let i = 0; i < 200 && !el.isPlaying; i++) await new Promise((r) => setTimeout(r, 10));
    expect(el.isPlaying).toBe(true);
  });

  it('refuses a forced fallback when the piece has none', async () => {
    const el = player(
      { src: MANIFEST, seed: '42', bars: '16', fallback: '' },
      server({ manifest: placeholder }),
    );
    const error = await once(el, 'error');
    expect(error.detail.messages.join('\n')).toContain('no fallback recording');
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(true);
    expect(el.fallbackReason).toBeNull();
  });

  it('reports a failed stem, then falls back, then is ready', async () => {
    // Corrupt a stem that seed 42 for 16 bars actually uses.
    const hash = realize(placeholder, '42', { durationBars: 16 })[0]!.clipHash;
    const el = player({ src: MANIFEST, seed: '42', bars: '16' }, server({ corruptStem: hash }));
    const seen = record(el, 'error', 'fallback', 'ready');
    await once(el, 'ready');
    expect(seen.map((e) => e.type)).toEqual(['error', 'fallback', 'ready']);
    expect((seen[0]!.detail as { messages: string[] }).messages.join('\n')).toContain(hash);
    expect(seen[1]!.detail).toEqual({ reason: 'stems', seed: 'spite-store', bars: 16 });
    expect(part(el, 'status').textContent).toContain(hash);
  });

  it('never falls back for an invalid manifest', async () => {
    const el = player(
      { src: MANIFEST, seed: '42', bars: '16' },
      server({ manifest: { ...invalidManifest, fallback: withFallback.fallback } }),
    );
    const seen = record(el, 'fallback');
    const error = await once(el, 'error');
    expect(error.detail.messages.join('\n')).toContain('/sections/2/next/1/to');
    expect(seen).toEqual([]);
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(true);
  });
});

describe('fallback mode playback', () => {
  it('shows the recording seed, disables seed controls and hides the lanes', async () => {
    const el = player({ src: MANIFEST, seed: '42', bars: '16', fallback: '' });
    await once(el, 'ready');
    await sized(el);
    expect(part<HTMLInputElement>(el, 'seed').value).toBe('spite-store');
    expect(part<HTMLInputElement>(el, 'seed').disabled).toBe(true);
    expect(part<HTMLButtonElement>(el, 'reroll').disabled).toBe(true);
    expect(part<HTMLInputElement>(el, 'bars').disabled).toBe(true);
    expect(part(el, 'lanes').hidden).toBe(true);
    expect(part(el, 'status').textContent).toContain('Fixed recording of seed spite-store');
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(false);
    expect(part<HTMLInputElement>(el, 'scrub').disabled).toBe(false);
    expect(Number(part<HTMLInputElement>(el, 'scrub').max)).toBeGreaterThan(0);
  });

  it('links to the recording seed and length', async () => {
    const original = location.href;
    const url = new URL(location.href);
    url.search = '';
    history.replaceState(null, '', url);
    try {
      const el = player({ src: MANIFEST, seed: '42', bars: '32', fallback: '' });
      await once(el, 'ready');
      const link = new URL(el.link());
      expect(link.searchParams.get('seed')).toBe('spite-store');
      expect(link.searchParams.get('bars')).toBe('16');
    } finally {
      history.replaceState(null, '', original);
    }
  });

  it('seeks within the recording', async () => {
    const el = player({ src: MANIFEST, seed: '42', bars: '16', fallback: '' });
    await once(el, 'ready');
    await sized(el);
    await el.seek(4800);
    expect(Math.abs(el.position - 4800)).toBeLessThanOrEqual(48);
  });

  it('plays to the end and fires ended once', async () => {
    const el = player({ src: MANIFEST, seed: '42', bars: '16', fallback: '' });
    await once(el, 'ready');
    await sized(el);
    let ended = 0;
    el.addEventListener('ended', () => ended++);
    const done = once(el, 'ended');
    await userEvent.click(part(el, 'play'));
    await done;
    await new Promise((r) => setTimeout(r, 200));
    expect(ended).toBe(1);
    expect(part(el, 'play').textContent).toBe('Play');
    expect(el.isPlaying).toBe(false);
  });

  it('pauses and resumes', async () => {
    const long = (() => {
      const tone = Float32Array.from({ length: 96000 }, (_, i) => Math.sin(i / 20) * 0.05);
      return encodeWav16([tone, tone]);
    })();
    const hash = `sha256:${await sha256Hex(long)}`;
    const manifest = { ...placeholder, fallback: { ...withFallback.fallback!, hash } };
    const srv = server({ manifest });
    const fetchLong = (async (input: RequestInfo | URL) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.endsWith(`${hash.slice(7)}.mp3`)) return new Response(long);
      return srv.fetch(input);
    }) as typeof fetch;
    const el = player(
      { src: MANIFEST, seed: '42', bars: '16', fallback: '' },
      { ...srv, fetch: fetchLong },
    );
    await once(el, 'ready');
    await sized(el);
    await userEvent.click(part(el, 'play'));
    for (let i = 0; i < 200 && !el.isPlaying; i++) await new Promise((r) => setTimeout(r, 10));
    expect(el.isPlaying).toBe(true);
    expect(part(el, 'play').textContent).toBe('Pause');
    await el.pause();
    expect(el.isPlaying).toBe(false);
    expect(part(el, 'play').textContent).toBe('Play');
  });
});

describe('fallback file verification', () => {
  it('refuses a recording whose bytes do not match its hash', async () => {
    const el = player(
      { src: MANIFEST, seed: '42', bars: '16', fallback: '' },
      server({ fallbackBytes: recording.slice(0, -2) }),
    );
    const error = await once(el, 'error');
    expect(error.detail.messages.join('\n')).toContain(recordingHash);
    expect(error.detail.messages.join('\n')).toContain('does not match');
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(true);
  });

  it('reports a missing recording', async () => {
    const el = player(
      { src: MANIFEST, seed: '42', bars: '16', fallback: '' },
      server({ fallbackBytes: null }),
    );
    const error = await once(el, 'error');
    expect(error.detail.messages.join('\n')).toContain(recordingHash);
    expect(error.detail.messages.join('\n')).toContain('404');
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(true);
  });

  it('returns to generative mode when the fallback attribute is removed', async () => {
    const el = player({ src: MANIFEST, seed: '42', bars: '16', fallback: '' });
    await once(el, 'ready');
    const ready = once(el, 'ready');
    el.removeAttribute('fallback');
    await ready;
    expect(el.fallbackReason).toBeNull();
    expect(el.performance).not.toBeNull();
    expect(part<HTMLInputElement>(el, 'seed').disabled).toBe(false);
    expect(part(el, 'lanes').hidden).toBe(false);
  });
});

describe('a manifest pinned to other engine formats', () => {
  /** Trace 99 is newer than any engine the player bundles. */
  const NEWER = { trace: 99, render: 1 };

  it('plays the fallback without fetching any stem, saying a later player made it', async () => {
    const srv = server({ manifest: { ...withFallback, engine: NEWER } });
    const el = player({ src: MANIFEST, seed: '42', bars: '16' }, srv);
    const seen = record(el, 'fallback', 'ready', 'error');
    await once(el, 'ready');
    expect(seen.map((e) => e.type)).toEqual(['fallback', 'ready']);
    expect(seen[0]!.detail).toEqual({ reason: 'engine', seed: 'spite-store', bars: 16 });
    expect(el.fallbackReason).toBe('engine');
    expect(srv.wavRequests).toEqual([]);
    const status = part(el, 'status').textContent!;
    expect(status).toContain('a later version of the player');
    expect(status).toContain('trace format 99');
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(false);
  });

  it('without a fallback shows an error naming both formats and stays disabled', async () => {
    const noFallback: Manifest = { ...withFallback, engine: NEWER };
    delete noFallback.fallback;
    const srv = server({ manifest: noFallback });
    const el = player({ src: MANIFEST, seed: '42', bars: '16' }, srv);
    const seen = record(el, 'fallback', 'ready', 'error');
    const error = await once(el, 'error');
    expect(seen.map((e) => e.type)).toEqual(['error']);
    expect(error.detail.messages.join('\n')).toMatch(/trace format 99, this engine has \d+/);
    expect(part(el, 'status').textContent).toContain('trace format 99');
    expect(part(el, 'status').classList.contains('error')).toBe(true);
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(true);
    expect(srv.wavRequests).toEqual([]);
    expect(srv.mp3Requests).toEqual([]);
  });

  it('gives way to the fallback attribute', async () => {
    const srv = server({ manifest: { ...withFallback, engine: NEWER } });
    const el = player({ src: MANIFEST, seed: '42', bars: '16', fallback: '' }, srv);
    const fallback = once(el, 'fallback');
    await once(el, 'ready');
    expect((await fallback).detail.reason).toBe('forced');
  });

  it('plays an unpinned manifest generatively', async () => {
    const unpinned: Manifest = { ...withFallback };
    delete unpinned.engine;
    const srv = server({ manifest: unpinned });
    const el = player({ src: MANIFEST, seed: '42', bars: '16' }, srv);
    const seen = record(el, 'fallback', 'ready', 'error');
    await once(el, 'ready');
    expect(seen.map((e) => e.type)).toEqual(['ready']);
    expect(el.fallbackReason).toBeNull();
    expect(srv.wavRequests.length).toBeGreaterThan(0);
  });
});
