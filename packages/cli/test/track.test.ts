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
import { decodeFlac, decodeWav, quantize16 } from '@spite-store/engine';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatDuration, trackCommand } from '../src/commands/track.js';
import { loadRelease } from '../src/release.js';
import { renderSeedWav } from '../src/render.js';
import { formatVersions } from '../src/versions.js';
import { root, sha256, spite, tempDir } from './helpers.js';

const placeholder = join(root, 'pieces/placeholder/manifest.json');
type Clips = Record<string, { hash: string }>;
const hex = (hash: string) => hash.slice('sha256:'.length);

let placeholderStems: string;
beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts/stems-placeholder.mjs')], { cwd: root });
  placeholderStems = tempDir();
  const clips = JSON.parse(readFileSync(placeholder, 'utf8')).clips as Clips;
  for (const { hash } of Object.values(clips)) {
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
 * A scratch placeholder frozen as `v1` (and, when `edit` is given, an edited `v2`): its piece dir
 * with manifest.json and versions.json, and a stems dir with its stems and frozen manifests.
 */
function frozenPiece(edit?: (m: Record<string, unknown>) => void) {
  const pieceDir = join(tempDir(), 'placeholder');
  mkdirSync(pieceDir);
  const stems = tempDir();
  for (const name of readdirSync(placeholderStems)) {
    copyFileSync(join(placeholderStems, name), join(stems, name));
  }
  const manifest = join(pieceDir, 'manifest.json');
  const entries: { hash: string; label: string }[] = [];
  const freeze = (bytes: Buffer, label: string) => {
    const hash = `sha256:${sha256(bytes)}`;
    writeFileSync(join(stems, `${hex(hash)}.json`), bytes);
    writeFileSync(manifest, bytes);
    entries.push({ hash, label });
    writeFileSync(join(pieceDir, 'versions.json'), formatVersions(entries));
    return hash;
  };
  const v1 = freeze(readFileSync(placeholder), 'v1');
  let v2: string | undefined;
  if (edit) {
    const m = JSON.parse(readFileSync(placeholder, 'utf8'));
    edit(m);
    v2 = freeze(Buffer.from(JSON.stringify(m, null, 2) + '\n'), 'v2');
  }
  return { pieceDir, manifest, stems, v1, v2, release: join(pieceDir, 'release.json') };
}

function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
  let code: number;
  try {
    code = trackCommand(argv);
  } catch (error) {
    code = -1;
    err.push(String(error));
  }
  vi.restoreAllMocks();
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const args = (p: { manifest: string; stems: string }, extra: Record<string, string> = {}) => {
  const o = {
    id: 'first-light',
    version: 'v1',
    seed: 'ox-bow',
    bars: '6',
    title: 'First Light',
    ...extra,
  };
  return [p.manifest, '--stems', p.stems, ...Object.entries(o).flatMap(([k, v]) => [`--${k}`, v])];
};
const flacs = (stems: string) =>
  readdirSync(stems)
    .filter((n) => n.endsWith('.flac'))
    .sort();
const audioOf = (out: string) => /sha256:[0-9a-f]{64}/.exec(out)?.[0];

describe('spite track: rendering', () => {
  it('writes the track by hash and prints the hash, duration and size', () => {
    const p = frozenPiece();
    const before = flacs(p.stems);
    const r = run(args(p));
    // Not yet recorded, so the check fails, but the audio is written.
    expect(r.code).toBe(1);
    const audio = audioOf(r.out)!;
    expect(audio).toBeDefined();
    const file = join(p.stems, `${hex(audio)}.flac`);
    expect(`sha256:${sha256(readFileSync(file))}`).toBe(audio);
    expect(flacs(p.stems)).toEqual([...before, `${hex(audio)}.flac`].sort());
    expect(r.out).toMatch(/\d+:\d\d {2}\d+\.\d MB/);
  });

  it('gives the same bytes on a second run', () => {
    const p = frozenPiece();
    expect(audioOf(run(args(p)).out)).toBe(audioOf(run(args(p)).out));
  });

  it('renders the frozen version, not the working manifest', () => {
    const p = frozenPiece();
    const before = audioOf(run(args(p)).out);
    const m = JSON.parse(readFileSync(p.manifest, 'utf8'));
    for (const clip of Object.values(m.clips as Record<string, { gain?: number }>)) clip.gain = 0.1;
    writeFileSync(p.manifest, JSON.stringify(m));
    expect(audioOf(run(args(p)).out)).toBe(before);
  });

  it('renders the version the label names', () => {
    const p = frozenPiece((m) => {
      for (const clip of Object.values(m.clips as Record<string, { gain?: number }>))
        clip.gain = 0.1;
    });
    const v1 = audioOf(run(args(p)).out);
    const v2 = audioOf(run(args(p, { id: 'quiet', version: 'v2' })).out);
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    expect(v2).not.toBe(v1);
  });

  it('is the bounce render at 24 bits', () => {
    const p = frozenPiece();
    const audio = audioOf(run(args(p)).out)!;
    const track = decodeFlac(readFileSync(join(p.stems, `${hex(audio)}.flac`)), 'track');
    const frozen = JSON.parse(readFileSync(join(p.stems, `${hex(p.v1)}.json`), 'utf8'));
    const bounced = renderSeedWav(frozen, 'ox-bow', 6, p.stems);
    if ('problems' in bounced) throw new Error('missing stems');
    const wav = decodeWav(bounced.wav, 'bounce');
    expect(track.frames).toBe(wav.frames);
    let worst = 0;
    for (let c = 0; c < 2; c++) {
      for (let f = 0; f < track.frames; f++) {
        const int24 = Math.round(track.channels[c]![f]! * 8388608);
        const asBounce = quantize16(int24 / 8388607);
        const bounce = Math.round(wav.channels[c]![f]! * 32768);
        worst = Math.max(worst, Math.abs(asBounce - bounce));
      }
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('formats lengths as m:ss, rounded down', () => {
    expect(formatDuration(6_432_000)).toBe('2:14');
    expect(formatDuration(47_999)).toBe('0:00');
    expect(formatDuration(48_000 * 600)).toBe('10:00');
  });
});

describe('spite track: input checks', () => {
  /** Runs and asserts that nothing was written: no new FLAC, no release.json. */
  function refused(p: ReturnType<typeof frozenPiece>, argv: string[]) {
    const before = flacs(p.stems);
    const r = run(argv);
    expect(flacs(p.stems)).toEqual(before);
    expect(existsSync(p.release)).toBe(false);
    return r;
  }

  it('names an unknown label and exits 1', () => {
    const p = frozenPiece((m) => void (m.title = 'Edited'));
    const r = refused(p, args(p, { version: 'v9' }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('"v9"');
  });

  it('says to run spite freeze when the frozen manifest is not local, and exits 2', () => {
    const p = frozenPiece();
    rmSync(join(p.stems, `${hex(p.v1)}.json`));
    const r = refused(p, args(p));
    expect(r.code).toBe(2);
    expect(r.err).toContain(hex(p.v1));
    expect(r.err).toContain('spite freeze');
    expect(r.err).toContain('from the store');
  });

  it('refuses a frozen manifest that does not hash to its name, and exits 2', () => {
    const p = frozenPiece();
    writeFileSync(join(p.stems, `${hex(p.v1)}.json`), '{}');
    const r = refused(p, args(p));
    expect(r.code).toBe(2);
    expect(r.err).toContain('does not hash');
  });

  it('names a missing stem and exits 2', () => {
    const p = frozenPiece();
    const clips = JSON.parse(readFileSync(placeholder, 'utf8')).clips as Clips;
    const [id, { hash }] = Object.entries(clips).find(([k]) => k === 'count')!;
    rmSync(join(p.stems, `${hex(hash)}.flac`));
    const r = refused(p, args(p));
    expect(r.code).toBe(2);
    expect(r.err).toContain(id);
    expect(r.err).toContain(hash);
  });

  it('refuses a frozen manifest pinned to other formats, and exits 1', () => {
    const p = frozenPiece((m) => void (m.engine = { trace: 99, render: 1 }));
    const r = refused(p, args(p, { version: 'v2' }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('/engine/trace');
  });

  it('refuses an invalid release.json, and exits 1', () => {
    const p = frozenPiece();
    writeFileSync(p.release, JSON.stringify({ price: 5 }));
    const before = flacs(p.stems);
    const r = run(args(p));
    expect(r.code).toBe(1);
    expect(r.err).toContain('release.json  /price');
    expect(flacs(p.stems)).toEqual(before);
    expect(readFileSync(p.release, 'utf8')).toBe(JSON.stringify({ price: 5 }));
  });

  it.each([
    ['no title', ['title']],
    ['no id', ['id']],
    ['no version', ['version']],
    ['no seed', ['seed']],
    ['no bars', ['bars']],
  ])('prints usage with %s, and exits 2', (_, drop) => {
    const p = frozenPiece();
    const argv = args(p);
    const i = argv.indexOf(`--${drop[0]}`);
    argv.splice(i, 2);
    expect(() => trackCommand(argv)).toThrow(`track needs --${drop[0]}`);
  });

  it.each([
    ['--id', 'First Light'],
    ['--bars', '0'],
    ['--bars', '1.5'],
  ])('refuses %s %j as a usage error', (flag, value) => {
    const p = frozenPiece();
    expect(() => trackCommand(args(p, { [flag.slice(2)]: value }))).toThrow();
  });

  it('exits 2 with usage through the binary', async () => {
    const r = await spite(
      'track',
      placeholder,
      '--id',
      'x',
      '--version',
      'v1',
      '--seed',
      's',
      '--bars',
      '4',
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('track needs --title');
    expect(r.stderr).toContain('Usage: spite');
  });
});

describe('spite track: recording', () => {
  it('records a new track in a new release.json that passes validation', () => {
    const p = frozenPiece();
    const r = run([...args(p), '--update']);
    expect(r.code).toBe(0);
    const audio = audioOf(r.out)!;
    const text = readFileSync(p.release, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "tracks": [\n    {\n      "id"');
    const loaded = loadRelease(p.pieceDir);
    expect(loaded).toMatchObject({
      release: {
        tracks: [
          {
            id: 'first-light',
            title: 'First Light',
            version: p.v1,
            seed: 'ox-bow',
            bars: 6,
            audio,
          },
        ],
      },
    });
    const frames = (loaded as { release: { tracks: { frames: number }[] } }).release.tracks[0]!
      .frames;
    expect(frames).toBe(decodeFlac(readFileSync(join(p.stems, `${hex(audio)}.flac`))).frames);
  });

  it('adds a track and leaves other fields and tracks as they are', () => {
    const p = frozenPiece();
    writeFileSync(
      p.release,
      JSON.stringify({ credits: [{ name: 'A. Composer', role: 'composition' }] }),
    );
    run([...args(p), '--update']);
    expect(run([...args(p, { id: 'eddy', seed: 'eddy', title: 'Eddy' }), '--update']).code).toBe(0);
    const data = JSON.parse(readFileSync(p.release, 'utf8'));
    expect(data.credits).toEqual([{ name: 'A. Composer', role: 'composition' }]);
    expect(data.tracks.map((t: { id: string }) => t.id)).toEqual(['first-light', 'eddy']);
  });

  it('retitles in place, changing only the title', () => {
    const p = frozenPiece();
    run([...args(p), '--update']);
    const before = JSON.parse(readFileSync(p.release, 'utf8'));
    const r = run([...args(p, { title: 'First Light (Dawn)' }), '--update']);
    expect(r.code).toBe(0);
    const after = JSON.parse(readFileSync(p.release, 'utf8'));
    expect(after).toEqual({
      ...before,
      tracks: [{ ...before.tracks[0], title: 'First Light (Dawn)' }],
    });
  });

  it("refuses to change a track's seed, printing both, and leaves release.json byte-identical", () => {
    const p = frozenPiece();
    run([...args(p), '--update']);
    const before = readFileSync(p.release);
    const r = run([...args(p, { seed: 'eddy' }), '--update']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('"ox-bow"');
    expect(r.err).toContain('"eddy"');
    expect(readFileSync(p.release).equals(before)).toBe(true);
  });

  it("refuses to change a track's version or bars", () => {
    const p = frozenPiece((m) => void (m.title = 'Edited'));
    run([...args(p), '--update']);
    const before = readFileSync(p.release);
    expect(run([...args(p, { version: 'v2' }), '--update']).code).toBe(1);
    expect(run([...args(p, { bars: '5' }), '--update']).code).toBe(1);
    expect(readFileSync(p.release).equals(before)).toBe(true);
  });
});

describe('spite track: checking', () => {
  it('reports a current track as up to date', () => {
    const p = frozenPiece();
    run([...args(p), '--update']);
    const r = run(args(p));
    expect(r.code).toBe(0);
    expect(r.out).toContain('up to date');
  });

  it("prints an unrecorded track's values and leaves release.json unchanged", () => {
    const p = frozenPiece();
    run([...args(p), '--update']);
    const before = readFileSync(p.release);
    const r = run(args(p, { id: 'eddy', seed: 'eddy' }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('"eddy" is not recorded');
    expect(r.err).toContain('seed  "eddy"');
    expect(readFileSync(p.release).equals(before)).toBe(true);
  });

  it('prints the difference for a changed title', () => {
    const p = frozenPiece();
    run([...args(p), '--update']);
    const r = run(args(p, { title: 'Other' }));
    expect(r.code).toBe(1);
    expect(r.err).toContain('title  recorded "First Light", now "Other"');
  });

  it('reports stale audio exactly', () => {
    const p = frozenPiece();
    run([...args(p), '--update']);
    const data = JSON.parse(readFileSync(p.release, 'utf8'));
    data.tracks[0].audio = `sha256:${'0'.repeat(64)}`;
    writeFileSync(p.release, JSON.stringify(data));
    const r = run(args(p));
    expect(r.code).toBe(1);
    expect(r.err).toContain('audio  recorded');
  });
});
