import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { ENGINE_FORMATS } from '@spite-store/engine';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { freezeCommand, type FreezeDeps } from '../src/commands/freeze.js';
import type { StemStore } from '../src/publish.js';
import { formatVersions } from '../src/versions.js';
import { root, sha256, spite, tempDir } from './helpers.js';

const placeholder = join(root, 'pieces/placeholder/manifest.json');
const river = join(root, 'pieces/the-river-forgets-to-answer/manifest.json');

type Clips = Record<string, { hash: string }>;
const clipsOf = (file: string) => JSON.parse(readFileSync(file, 'utf8')).clips as Clips;
const hex = (hash: string) => hash.slice('sha256:'.length);

/** An in-memory store that records every put; `reject` names files whose upload fails. */
function memoryStore(reject: (name: string) => boolean = () => false) {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const puts: string[] = [];
  const store: StemStore = {
    has: async (name) => files.has(name),
    put: async (name, bytes, contentType) => {
      if (files.has(name)) throw new Error(`${name} already exists`);
      if (reject(name)) throw new Error('network down');
      puts.push(name);
      files.set(name, { bytes, contentType });
    },
  };
  return { store, files, puts };
}

/** A `fetch` over the memory store's files, as the public store would serve them. */
function storeFetch(files: Map<string, { bytes: Uint8Array }>, base = 'https://store.test/stems/') {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const file = url.startsWith(base) ? files.get(url.slice(base.length)) : undefined;
    if (!file) return new Response(null, { status: 404 });
    return new Response(init?.method === 'HEAD' ? null : file.bytes, { status: 200 });
  }) as typeof fetch;
}

let placeholderStems: string;
beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts/stems-placeholder.mjs')], { cwd: root });
  placeholderStems = tempDir();
  for (const { hash } of Object.values(clipsOf(placeholder))) {
    copyFileSync(
      join(root, '.stems', `${hex(hash)}.flac`),
      join(placeholderStems, `${hex(hash)}.flac`),
    );
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A scratch copy of the placeholder: `<tmp>/<dir>/manifest.json` (written from `edit`'s result
 * when given) and a stems dir holding its stems.
 */
function scratch(edit?: (m: Record<string, unknown>) => unknown, dir = 'placeholder') {
  const pieceDir = join(tempDir(), dir);
  mkdirSync(pieceDir);
  const manifest = join(pieceDir, 'manifest.json');
  if (edit) {
    const m = JSON.parse(readFileSync(placeholder, 'utf8'));
    const result = edit(m);
    writeFileSync(
      manifest,
      typeof result === 'string' ? result : JSON.stringify(m, null, 2) + '\n',
    );
  } else {
    copyFileSync(placeholder, manifest);
  }
  const stems = tempDir();
  for (const name of readdirSync(placeholderStems)) {
    copyFileSync(join(placeholderStems, name), join(stems, name));
  }
  return { pieceDir, manifest, stems, versions: join(pieceDir, 'versions.json') };
}

/** Runs the command in-process, capturing its output. */
async function freeze(argv: string[], deps: FreezeDeps = {}) {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
  try {
    const code = await freezeCommand(argv, { env: { BLOB_READ_WRITE_TOKEN: 'test' }, ...deps });
    return { code, stdout: out.join('\n'), stderr: err.join('\n') };
  } finally {
    vi.restoreAllMocks();
  }
}

const jsonFiles = (dir: string) => readdirSync(dir).filter((n) => n.endsWith('.json'));
const fileHash = (file: string) => `sha256:${sha256(readFileSync(file))}`;

describe('spite freeze: input checks', () => {
  /** Asserts nothing was written locally and nothing uploaded. */
  const nothingDone = (s: ReturnType<typeof scratch>, puts: string[]) => {
    expect(jsonFiles(s.stems)).toEqual([]);
    expect(existsSync(s.versions)).toBe(false);
    expect(puts).toEqual([]);
  };

  it('refuses an unpinned manifest', async () => {
    const s = scratch((m) => void delete m.engine);
    const { store, puts } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('not pinned');
    nothingDone(s, puts);
  });

  it('refuses a mismatched pin, printing both trace formats', async () => {
    const s = scratch((m) => void (m.engine = { trace: 2, render: ENGINE_FORMATS.render }));
    const { store, puts } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`trace format 2, this engine has ${ENGINE_FORMATS.trace}`);
    expect(r.stderr).not.toContain('--ignore-pin');
    nothingDone(s, puts);
  });

  it('refuses an id that does not match the directory', async () => {
    const s = scratch(undefined, 'river');
    const { store, puts } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('"placeholder"');
    expect(r.stderr).toContain('"river"');
    nothingDone(s, puts);
  });

  it('refuses an invalid manifest', async () => {
    const s = scratch((m) => void (m.sections = []));
    const { store, puts } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code).toBe(1);
    nothingDone(s, puts);
  });

  it('names a missing local stem and exits 2', async () => {
    const s = scratch();
    const [id, { hash }] = Object.entries(clipsOf(placeholder))[0]!;
    rmSync(join(s.stems, `${hex(hash)}.flac`));
    const { store, puts } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(id);
    expect(r.stderr).toContain(hash);
    nothingDone(s, puts);
  });

  it.each([
    ['working', 'reserved'],
    ['b'.repeat(64), 'hash'],
    ['First Light', 'not a valid label'],
  ])('refuses --label %s and exits 2', async (label, message) => {
    const s = scratch();
    const { store, puts } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems, '--label', label], {
      store: async () => store,
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(message);
    nothingDone(s, puts);
  });

  it('without BLOB_READ_WRITE_TOKEN says so and exits 2', async () => {
    const s = scratch();
    const { store, puts } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store, env: {} });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('BLOB_READ_WRITE_TOKEN');
    nothingDone(s, puts);
  });

  it('refuses an invalid versions.json, naming the file', async () => {
    const s = scratch();
    writeFileSync(s.versions, '{ "versions": [], "latest": "v1" }\n');
    const { store, puts } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(s.versions);
    expect(r.stderr).toContain('"latest"');
    expect(puts).toEqual([]);
  });

  it.each([
    ['no manifest', ['freeze']],
    ['two manifests', ['freeze', placeholder, river]],
    ['--check without a URL', ['freeze', '--check', placeholder]],
    ['an unknown flag', ['freeze', placeholder, '--nope']],
  ])('prints usage and exits 2 with %s', async (_, args) => {
    const r = await spite(...args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Usage: spite');
  });
});

describe('spite freeze', () => {
  it('first freeze stores the manifest by hash and records v1', async () => {
    const s = scratch();
    const hash = fileHash(s.manifest);
    const { store, files } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`v1  ${hash}`);
    expect(readFileSync(join(s.stems, `${hex(hash)}.json`))).toEqual(readFileSync(s.manifest));
    expect(files.get(`${hex(hash)}.json`)?.contentType).toBe('application/json');
    expect(Buffer.from(files.get(`${hex(hash)}.json`)!.bytes)).toEqual(readFileSync(s.manifest));
    const stems = new Set(Object.values(clipsOf(placeholder)).map((c) => `${hex(c.hash)}.flac`));
    for (const name of stems) expect(files.has(name)).toBe(true);
    expect(readFileSync(s.versions, 'utf8')).toBe(formatVersions([{ hash, label: 'v1' }]));
  });

  it('labels count up: v1, v2, v3', async () => {
    const s = scratch();
    const { store } = memoryStore();
    const labels: string[] = [];
    for (const gain of [undefined, 0.9, 0.8]) {
      if (gain !== undefined) {
        const m = JSON.parse(readFileSync(s.manifest, 'utf8'));
        m.sections[0].slots[0].gain = gain;
        writeFileSync(s.manifest, JSON.stringify(m, null, 2) + '\n');
      }
      const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
      expect(r.code, r.stderr).toBe(0);
      labels.push(JSON.parse(readFileSync(s.versions, 'utf8')).versions.at(-1).label);
    }
    expect(labels).toEqual(['v1', 'v2', 'v3']);
  });

  it('takes a chosen label', async () => {
    const s = scratch();
    const { store } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems, '--label', 'first-light'], {
      store: async () => store,
    });
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(s.versions, 'utf8')).versions).toEqual([
      { hash: fileHash(s.manifest), label: 'first-light' },
    ]);
  });

  it('refuses a label already taken by another version', async () => {
    const s = scratch();
    const { store, puts } = memoryStore();
    await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    const before = readFileSync(s.versions, 'utf8');
    const uploaded = puts.length;
    const m = JSON.parse(readFileSync(s.manifest, 'utf8'));
    m.sections[0].slots[0].gain = 0.5;
    writeFileSync(s.manifest, JSON.stringify(m, null, 2) + '\n');
    const r = await freeze([s.manifest, '--stems', s.stems, '--label', 'v1'], {
      store: async () => store,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('"v1" is taken');
    expect(readFileSync(s.versions, 'utf8')).toBe(before);
    expect(puts).toHaveLength(uploaded);
  });

  it('a second freeze of the same bytes records and uploads nothing', async () => {
    const s = scratch();
    const { store, puts } = memoryStore();
    await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    const before = readFileSync(s.versions);
    const uploaded = puts.length;
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('v1');
    expect(r.stdout).toContain('already frozen');
    expect(readFileSync(s.versions)).toEqual(before);
    expect(puts).toHaveLength(uploaded);
  });

  it('refuses to relabel a recorded version', async () => {
    const s = scratch();
    const { store } = memoryStore();
    await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    const before = readFileSync(s.versions);
    const r = await freeze([s.manifest, '--stems', s.stems, '--label', 'final'], {
      store: async () => store,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('already labelled "v1"');
    expect(readFileSync(s.versions)).toEqual(before);
  });

  it('a failed upload records nothing and uploads no manifest', async () => {
    const s = scratch();
    const victim = `${hex(Object.values(clipsOf(placeholder))[0]!.hash)}.flac`;
    const { store, files } = memoryStore((name) => name === victim);
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(hex(Object.values(clipsOf(placeholder))[0]!.hash));
    expect(r.stderr).toContain('network down');
    expect(existsSync(s.versions)).toBe(false);
    expect([...files.keys()].some((n) => n.endsWith('.json'))).toBe(false);
  });

  it('reformatting makes a new version and leaves the first alone', async () => {
    const s = scratch();
    const { store } = memoryStore();
    await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    const first = fileHash(s.manifest);
    writeFileSync(
      s.manifest,
      JSON.stringify(JSON.parse(readFileSync(s.manifest, 'utf8')), null, 4),
    );
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code, r.stderr).toBe(0);
    const versions = JSON.parse(readFileSync(s.versions, 'utf8')).versions;
    expect(versions).toEqual([
      { hash: first, label: 'v1' },
      { hash: fileHash(s.manifest), label: 'v2' },
    ]);
    expect(versions[1].hash).not.toBe(first);
  });
});

describe('same version, same performance', () => {
  it.each([
    ['the River', river],
    ['the placeholder', placeholder],
  ])('the frozen copy of %s realizes the same trace for seed hello', async (_, source) => {
    const stored = join(tempDir(), `${sha256(readFileSync(source))}.json`);
    copyFileSync(source, stored);
    const a = await spite('realize', source, '--seed', 'hello', '--bars', '64', '--json');
    const b = await spite('realize', stored, '--seed', 'hello', '--bars', '64', '--json');
    expect(a.code, a.stderr).toBe(0);
    expect(b.stdout).toBe(a.stdout);
  });

  it('the frozen placeholder bounces to the same WAV bytes', async () => {
    const s = scratch();
    const { store } = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => store });
    expect(r.code, r.stderr).toBe(0);
    const stored = join(s.stems, `${hex(fileHash(s.manifest))}.json`);
    const out = tempDir();
    for (const [file, name] of [
      [s.manifest, 'working.wav'],
      [stored, 'frozen.wav'],
    ] as const) {
      const b = await spite(
        'bounce',
        file,
        '--seed',
        'hello',
        '--bars',
        '16',
        '--stems',
        s.stems,
        '-o',
        join(out, name),
      );
      expect(b.code, b.stderr).toBe(0);
    }
    expect(sha256(readFileSync(join(out, 'frozen.wav')))).toBe(
      sha256(readFileSync(join(out, 'working.wav'))),
    );
  });
});

describe('spite freeze --check', () => {
  const base = 'https://store.test/stems/';

  /** Freezes a scratch placeholder into a memory store, returning both. */
  async function frozen() {
    const s = scratch();
    const mem = memoryStore();
    const r = await freeze([s.manifest, '--stems', s.stems], { store: async () => mem.store });
    expect(r.code, r.stderr).toBe(0);
    return { s, mem, hash: fileHash(s.manifest) };
  }
  const check = (manifest: string, files: Map<string, { bytes: Uint8Array }>) =>
    freeze(['--check', base, manifest], { fetch: storeFetch(files, base), env: {} });

  it('reports every version reachable and exits 0, needing no token', async () => {
    const { s, mem, hash } = await frozen();
    const r = await check(s.manifest, mem.files);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`reachable  placeholder  v1  ${hash}`);
  });

  it('names a frozen manifest missing from the store', async () => {
    const { s, mem, hash } = await frozen();
    mem.files.delete(`${hex(hash)}.json`);
    const r = await check(s.manifest, mem.files);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`missing  placeholder  v1  ${hash}`);
  });

  it('names stored bytes that do not match as a mismatch', async () => {
    const { s, mem, hash } = await frozen();
    mem.files.set(`${hex(hash)}.json`, { bytes: new TextEncoder().encode('{}'), contentType: '' });
    const r = await check(s.manifest, mem.files);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`mismatch  placeholder  v1  ${hash}`);
  });

  it('names an unreachable stem of a recorded version', async () => {
    const { s, mem, hash } = await frozen();
    const [id, { hash: stem }] = Object.entries(clipsOf(placeholder))[0]!;
    mem.files.delete(`${hex(stem)}.flac`);
    const r = await check(s.manifest, mem.files);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`unreachable  placeholder  v1  ${hash}`);
    expect(r.stderr).toContain(id);
  });

  it('skips an unfrozen piece without failing', async () => {
    const s = scratch();
    const r = await check(s.manifest, new Map());
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('unfrozen  placeholder');
  });

  it('fails on an invalid versions.json, naming the file and the repeated label', async () => {
    const { s, mem, hash } = await frozen();
    const other = `sha256:${'a'.repeat(64)}`;
    writeFileSync(
      s.versions,
      formatVersions([
        { hash, label: 'v1' },
        { hash: other, label: 'v1' },
      ]),
    );
    const r = await check(s.manifest, mem.files);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(s.versions);
    expect(r.stderr).toContain('repeated label "v1"');
  });

  it('warns about a stranded version without failing', async () => {
    const { s, mem } = await frozen();
    // A version pinned to another trace format, recorded by hand since freeze would refuse it.
    const m = JSON.parse(readFileSync(s.manifest, 'utf8'));
    m.engine = { trace: 99, render: ENGINE_FORMATS.render };
    const bytes = new TextEncoder().encode(JSON.stringify(m, null, 2) + '\n');
    const hash = `sha256:${sha256(bytes)}`;
    mem.files.set(`${hex(hash)}.json`, { bytes, contentType: 'application/json' });
    const versions = JSON.parse(readFileSync(s.versions, 'utf8')).versions;
    writeFileSync(s.versions, formatVersions([...versions, { hash, label: 'v2' }]));
    const r = await check(s.manifest, mem.files);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/^warning: stranded {2}placeholder {2}v2 .*trace format 99/m);
  });
});
