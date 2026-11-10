import { barFrame, canonicalTrace, synthesizeStemWav, type Manifest } from '@spite-store/engine';
import { afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import invalidManifest from '../../../schema/examples/invalid/dangling-transition.json';
import '../src/index.js';
import type { SpitePlayer } from '../src/index.js';
import { LABEL_WIDTH, layoutLanes } from '../src/lanes.js';
import { placeholder, placeholderStemFiles, sha256Hex, workletUrl } from './helpers.js';

declare module 'vitest' {
  export interface ProvidedContext {
    cliTraceSha256: string;
  }
}

const MANIFEST = '/pieces/placeholder/manifest.json';
let files: Map<string, Uint8Array>;
const created: SpitePlayer[] = [];

beforeAll(async () => {
  files = await placeholderStemFiles();
});

afterEach(() => {
  for (const p of created.splice(0)) p.remove();
});

interface Server {
  fetch: typeof fetch;
  stemRequests: string[];
}

/** A fake server for manifests and stems, recording stem requests. */
function server(
  options: {
    manifests?: Record<string, unknown>;
    stems?: Map<string, Uint8Array>;
    corrupt?: string;
  } = {},
): Server {
  const manifests = options.manifests ?? { [MANIFEST]: placeholder };
  const stems = options.stems ?? files;
  const stemRequests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.pathname in manifests) return new Response(JSON.stringify(manifests[url.pathname]));
    const match = /^\/stems\/([0-9a-f]{64})\.wav$/.exec(url.pathname);
    if (match) {
      stemRequests.push(match[1]!);
      const hash = `sha256:${match[1]}`;
      const bytes = stems.get(hash);
      if (!bytes) return new Response('not found', { status: 404 });
      const body = hash === options.corrupt ? bytes.slice(0, bytes.length - 2) : bytes;
      return new Response(body);
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchImpl, stemRequests };
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

/** The next `type` event; rejects with the messages if an `error` event comes first instead. */
function next(
  el: SpitePlayer,
  type: 'ready' | 'error' | 'ended' | 'seedchange',
): Promise<CustomEvent> {
  return new Promise((resolve, reject) => {
    el.addEventListener(type, (e) => resolve(e as CustomEvent), { once: true });
    if (type !== 'error') {
      el.addEventListener(
        'error',
        (e) => reject(new Error((e as CustomEvent).detail.messages.join('\n'))),
        {
          once: true,
        },
      );
    }
  });
}

const part = <T extends Element>(el: SpitePlayer, name: string) =>
  el.shadowRoot!.querySelector<T>(`[part='${name}']`)!;

describe('<spite-player>', () => {
  it('loads a minimal embed and enables play', async () => {
    const el = player({ src: MANIFEST, seed: 'hello', bars: '16' });
    await next(el, 'ready');
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(false);
    expect(part<HTMLInputElement>(el, 'seed').value).toBe('hello');
    expect(part<HTMLInputElement>(el, 'bars').value).toBe('16');
  });

  it.each(['0', '-3', '1.5', 'many'])('rejects bars="%s"', async (bars) => {
    const el = player({ src: MANIFEST, seed: 'x', bars });
    const error = await next(el, 'error');
    expect(error.detail.messages.join(' ')).toContain('bars');
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(true);
  });

  it('fetches only the stems the performance uses and reports progress', async () => {
    const srv = server();
    const el = player({ src: MANIFEST, seed: '42', bars: '16' }, srv);
    await next(el, 'ready');
    const needed = new Set(el.performance!.events.map((e) => e.clipHash.slice(7)));
    expect(needed.size).toBeLessThan(Object.keys(placeholder.clips).length);
    expect(srv.stemRequests.sort()).toEqual([...needed].sort());
    expect(part(el, 'status').textContent).toContain(`stems ${needed.size} / ${needed.size}`);
  });

  it('refuses a stem whose bytes do not match its hash', async () => {
    const hash = placeholder.clips['count']!.hash;
    const el = player({ src: MANIFEST, seed: '42', bars: '16' }, server({ corrupt: hash }));
    const error = await next(el, 'error');
    expect(error.detail.messages.join('\n')).toMatch(new RegExp(`count.*${hash}.*does not match`));
    expect(part<HTMLButtonElement>(el, 'play').disabled).toBe(true);
  });

  it('shows validation errors for an invalid manifest', async () => {
    const el = player(
      { src: '/bad.json', seed: '1' },
      server({ manifests: { '/bad.json': invalidManifest } }),
    );
    const error = await next(el, 'error');
    expect(error.detail.messages.join('\n')).toContain('/sections/2/next/1/to');
    expect(part(el, 'status').textContent).toContain('coda');
  });

  it('plays exactly the trace `spite realize --json` prints', async () => {
    const el = player({ src: MANIFEST, seed: '42', bars: '16' });
    await next(el, 'ready');
    expect(await sha256Hex(new TextEncoder().encode(canonicalTrace(el.performance!.events)))).toBe(
      inject('cliTraceSha256'),
    );
  });

  it('chooses, shows and announces a pronounceable seed that is reproducible', async () => {
    const el = document.createElement('spite-player') as SpitePlayer;
    el.fetchImpl = server().fetch;
    el.setAttribute('src', MANIFEST);
    el.setAttribute('stems', '/stems/');
    el.setAttribute('bars', '8');
    created.push(el);
    const announced = next(el, 'seedchange');
    const ready = next(el, 'ready');
    document.body.append(el);
    const seed = el.getAttribute('seed')!;
    expect(seed).toMatch(/^([bcdfghjklmnprstvz][aeiou]){4}$/);
    expect((await announced).detail).toEqual({ seed, bars: 8 });
    await ready;
    expect(part<HTMLInputElement>(el, 'seed').value).toBe(seed);
    const twin = player({ src: MANIFEST, seed, bars: '8' });
    await next(twin, 'ready');
    expect(twin.performance!.events).toEqual(el.performance!.events);
  });

  it('rerolls to a new seed and announces it', async () => {
    const el = player({ src: MANIFEST, seed: 'first', bars: '8' });
    await next(el, 'ready');
    const announced = next(el, 'seedchange');
    const ready = next(el, 'ready');
    part<HTMLButtonElement>(el, 'reroll').click();
    const { seed } = (await announced).detail;
    expect(seed).not.toBe('first');
    await ready;
    expect(el.performance!.seed).toBe(seed);
    expect(part<HTMLInputElement>(el, 'seed').value).toBe(seed);
  });

  it('builds a link with seed and bars, keeping other query parameters', async () => {
    const original = location.href;
    const url = new URL(location.href);
    url.searchParams.set('x', '1');
    history.replaceState(null, '', url);
    try {
      const el = player({ src: MANIFEST, seed: 'tamirobe', bars: '32' });
      await next(el, 'ready');
      const link = new URL(el.link());
      expect(link.searchParams.get('x')).toBe('1');
      expect(link.searchParams.get('seed')).toBe('tamirobe');
      expect(link.searchParams.get('bars')).toBe('32');
      part<HTMLButtonElement>(el, 'copy').click();
      await new Promise((r) => setTimeout(r, 50));
      expect(part(el, 'status').textContent).toMatch(/Link copied|seed=tamirobe/);
    } finally {
      history.replaceState(null, '', original);
    }
  });

  it('reloads when the seed attribute changes', async () => {
    const el = player({ src: MANIFEST, seed: 'a', bars: '16' });
    await next(el, 'ready');
    const before = el.performance!.events;
    const ready = next(el, 'ready');
    el.setAttribute('seed', 'b');
    await ready;
    expect(el.performance!.seed).toBe('b');
    expect(el.performance!.events).not.toEqual(before);
  });

  it('draws lanes from the plan and seeks where the view is clicked', async () => {
    const el = player({ src: MANIFEST, seed: '42', bars: '16' });
    el.style.width = '800px';
    await next(el, 'ready');
    const perf = el.performance!;
    const layout = layoutLanes(perf);
    expect(layout.rows).toEqual([...new Set(perf.events.map((e) => e.slot))].sort());
    expect(layout.blocks).toHaveLength(perf.events.length);
    expect(layout.sections.map((s) => s.label)).toEqual(perf.visits.map((v) => v.sectionId));

    const canvas = part<HTMLCanvasElement>(el, 'lanes');
    const rect = canvas.getBoundingClientRect();
    const span = rect.width - LABEL_WIDTH;
    const target = barFrame(placeholder, 5);
    const x = LABEL_WIDTH + (target / perf.plan.totalFrames) * span;
    canvas.dispatchEvent(
      new MouseEvent('click', { clientX: rect.left + x, clientY: rect.top + 30, bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 20));
    // The click's time: what the view maps the (possibly integer) event coordinate to.
    const event = new MouseEvent('click', { clientX: rect.left + x });
    const clicked = Math.round(
      ((event.clientX - rect.left - LABEL_WIDTH) / span) * perf.plan.totalFrames,
    );
    expect(Math.abs(el.position - clicked)).toBeLessThanOrEqual(1);
    expect(Math.abs(el.position - target)).toBeLessThanOrEqual(perf.plan.totalFrames / span + 1);
  });

  it('seeks to the start of a bar exactly', async () => {
    const el = player({ src: MANIFEST, seed: '42', bars: '16' });
    await next(el, 'ready');
    await el.seekToBar(8);
    expect(el.position).toBe(barFrame(placeholder, 8));
  });

  it('plays to the end, fires ended once and rests at the end', async () => {
    const recipe = {
      kind: 'clicks',
      frames: 4800,
      level: 0.5,
      every: 2400,
      accentEvery: 2,
      clickFrames: 240,
    } as const;
    const bytes = synthesizeStemWav(recipe, 'tick');
    const hash = `sha256:${await sha256Hex(bytes)}`;
    const tiny: Manifest = {
      specVersion: '0.1',
      id: 'tiny',
      title: 'Tiny',
      tempo: [{ bar: 0, bpm: 240, meter: [1, 4] }],
      clips: { tick: { hash, lengthBars: 1 } },
      start: 's',
      sections: [
        { id: 's', lengthBars: 2, slots: [{ id: 'x', pool: [{ clip: 'tick', weight: 1 }] }] },
      ],
    };
    const el = player(
      { src: '/tiny.json', seed: '1', bars: '2' },
      server({ manifests: { '/tiny.json': tiny }, stems: new Map([[hash, bytes]]) }),
    );
    await next(el, 'ready');
    let ended = 0;
    el.addEventListener('ended', () => ended++);
    const done = next(el, 'ended');
    await userEvent.click(part(el, 'play'));
    await done;
    await new Promise((r) => setTimeout(r, 300));
    expect(ended).toBe(1);
    expect(part(el, 'play').textContent).toBe('Play');
    expect(el.position).toBe(el.performance!.plan.totalFrames);
    expect(el.isPlaying).toBe(false);
  });
});
