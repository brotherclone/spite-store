import { execFile, execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { root, sha256, tempDir, type Run } from './helpers.js';

const bin = join(root, 'packages/cli/bin/spite.js');
const placeholder = join(root, 'pieces/placeholder/manifest.json');

/**
 * A stand-in for ffmpeg: lists libmp3lame, copies its stdin to $FAKE_CAPTURE when set, and writes
 * "FAKEMP3" plus the sha256 of its input, so the output is a deterministic function of the render.
 */
function fakeFfmpeg(dir: string): string {
  const file = join(dir, 'ffmpeg');
  writeFileSync(
    file,
    `#!${process.execPath}
const { createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');
if (process.argv.includes('-encoders')) {
  process.stdout.write(' A....D libmp3lame           libmp3lame MP3 (MPEG audio layer 3)\\n');
  process.exit(0);
}
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const input = Buffer.concat(chunks);
  if (process.env.FAKE_CAPTURE) writeFileSync(process.env.FAKE_CAPTURE, input);
  process.stdout.write('FAKEMP3' + createHash('sha256').update(input).digest('hex'));
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

function run(args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [bin, ...args],
      { cwd: root, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr }),
    );
  });
}

/** A copy of the placeholder manifest that a test may rewrite. */
function manifestCopy(): string {
  const file = join(tempDir(), 'manifest.json');
  copyFileSync(placeholder, file);
  return file;
}

let ffmpeg: string;
/** A private stems directory holding the placeholder's stems, so tests never write to .stems/. */
let stems: string;
beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts/stems-placeholder.mjs')], { cwd: root });
  ffmpeg = fakeFfmpeg(tempDir());
  stems = tempDir();
  const clips = JSON.parse(readFileSync(placeholder, 'utf8')).clips as Record<
    string,
    { hash: string }
  >;
  for (const { hash } of Object.values(clips)) {
    const name = `${hash.slice('sha256:'.length)}.wav`;
    copyFileSync(join(root, '.stems', name), join(stems, name));
  }
});

const fallback = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  run(['fallback', ...args, ...(args.includes('--stems') ? [] : ['--stems', stems])], {
    SPITE_FFMPEG: ffmpeg,
    ...env,
  });

describe('spite fallback', () => {
  it('writes the MP3 into the stems directory by hash and prints the hash', async () => {
    const r = await fallback([manifestCopy(), '--seed', '42', '--bars', '16', '--update']);
    expect(r.code, r.stderr).toBe(0);
    const hash = /sha256:([0-9a-f]{64})/.exec(r.stdout)![1]!;
    const file = join(stems, `${hash}.mp3`);
    expect(existsSync(file)).toBe(true);
    expect(sha256(readFileSync(file))).toBe(hash);
    expect(r.stdout).toMatch(/\d+\.\d\d s {2}\d+\.\d\d MB/);
  });

  it('encodes exactly the WAV that spite bounce writes', async () => {
    const dir = tempDir();
    const capture = join(dir, 'captured.wav');
    const bounced = join(dir, 'bounced.wav');
    const r = await fallback([manifestCopy(), '--seed', '42', '--bars', '16', '--update'], {
      FAKE_CAPTURE: capture,
    });
    expect(r.code, r.stderr).toBe(0);
    const b = await run(['bounce', placeholder, '--seed', '42', '--bars', '16', '-o', bounced], {});
    expect(b.code).toBe(0);
    expect(sha256(readFileSync(capture))).toBe(sha256(readFileSync(bounced)));
  });

  it('with --update records the fallback and changes nothing else', async () => {
    const manifest = manifestCopy();
    const before = JSON.parse(readFileSync(manifest, 'utf8'));
    const r = await fallback([manifest, '--seed', 'spite-store', '--bars', '64', '--update']);
    expect(r.code, r.stderr).toBe(0);
    const after = JSON.parse(readFileSync(manifest, 'utf8'));
    const hash = /sha256:[0-9a-f]{64}/.exec(r.stdout)![0];
    expect(after.fallback).toEqual({ hash, type: 'audio/mpeg', seed: 'spite-store', bars: 64 });
    delete after.fallback;
    expect(after).toEqual(before);
    expect((await run(['validate', manifest], {})).code).toBe(0);
  });

  it('exits 0 without --update when the recorded fallback matches', async () => {
    const manifest = manifestCopy();
    await fallback([manifest, '--seed', 'a', '--bars', '8', '--update']);
    const text = readFileSync(manifest, 'utf8');
    const r = await fallback([manifest, '--seed', 'a', '--bars', '8']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('up to date');
    expect(readFileSync(manifest, 'utf8')).toBe(text);
  });

  it('reports a stale fallback, leaves the manifest unchanged and exits 1', async () => {
    const manifest = manifestCopy();
    await fallback([manifest, '--seed', 'a', '--bars', '8', '--update']);
    const text = readFileSync(manifest, 'utf8');
    const r = await fallback([manifest, '--seed', 'b', '--bars', '8']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('seed "a"');
    expect(r.stderr).toContain('seed "b"');
    expect(r.stderr).toMatch(/sha256:[0-9a-f]{64}[\s\S]*sha256:[0-9a-f]{64}/);
    expect(readFileSync(manifest, 'utf8')).toBe(text);
  });

  it('names missing stems, writes nothing and exits 2', async () => {
    const manifest = manifestCopy();
    const text = readFileSync(manifest, 'utf8');
    const empty = tempDir();
    const r = await fallback([manifest, '--seed', '1', '--bars', '16', '--stems', empty]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/stem \S.* {2}sha256:[0-9a-f]{64} {2}missing/);
    expect(readdirSync(empty)).toEqual([]);
    expect(readFileSync(manifest, 'utf8')).toBe(text);
  });

  it('exits 1 on an invalid manifest', async () => {
    const r = await fallback(['schema/examples/invalid/dangling-transition.json', '--seed', '1']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('/sections/2/next/1/to');
  });

  it.each([
    ['no seed', [placeholder]],
    ['no manifest', ['--seed', '1']],
    ['bad bars', [placeholder, '--seed', '1', '--bars', '0']],
    ['unknown flag', [placeholder, '--seed', '1', '--nope']],
  ])('prints usage and exits 2 with %s', async (_, args) => {
    const r = await fallback(args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Usage: spite');
  });

  it('without ffmpeg says so, writes nothing and exits 2', async () => {
    const manifest = manifestCopy();
    const text = readFileSync(manifest, 'utf8');
    const empty = tempDir();
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: tempDir() };
    delete env.SPITE_FFMPEG;
    const r = await new Promise<Run>((resolve) =>
      execFile(
        process.execPath,
        [bin, 'fallback', manifest, '--seed', '1', '--bars', '4', '--stems', empty, '--update'],
        { cwd: root, env },
        (error, stdout, stderr) =>
          resolve({ code: error ? (error.code as number) : 0, stdout, stderr }),
      ),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('ffmpeg');
    expect(readdirSync(empty)).toEqual([]);
    expect(readFileSync(manifest, 'utf8')).toBe(text);
  });
});

describe('spite fallback with an ffmpeg lacking MP3', () => {
  it('says libmp3lame is missing and exits 2', async () => {
    const dir = tempDir();
    const noMp3 = join(dir, 'ffmpeg');
    writeFileSync(noMp3, `#!${process.execPath}\nprocess.stdout.write(' A....D aac  AAC\\n');\n`);
    chmodSync(noMp3, 0o755);
    const r = await fallback([manifestCopy(), '--seed', '1', '--bars', '4'], {
      SPITE_FFMPEG: noMp3,
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('libmp3lame');
  });
});

const hasFfmpeg = (() => {
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-encoders']).toString().includes('libmp3lame');
  } catch {
    return false;
  }
})();

/** Reads the first MPEG audio frame header: version, layer, sample rate and channel mode. */
function firstFrame(mp3: Buffer) {
  for (let i = 0; i + 4 <= mp3.length; i++) {
    if (mp3[i] !== 0xff || (mp3[i + 1]! & 0xe0) !== 0xe0) continue;
    const version = (mp3[i + 1]! >> 3) & 3; // 3 = MPEG-1
    const layer = (mp3[i + 1]! >> 1) & 3; // 1 = Layer III
    const rate = (mp3[i + 2]! >> 2) & 3; // MPEG-1: 0 = 44.1k, 1 = 48k, 2 = 32k
    const bitrate = mp3[i + 2]! >> 4; // MPEG-1 Layer III: 13 = 256 kbps
    const mode = mp3[i + 3]! >> 6; // 3 = mono
    if (version === 3 && layer === 1 && rate !== 3 && bitrate !== 0 && bitrate !== 15)
      return { sampleRate: [44100, 48000, 32000][rate], stereo: mode !== 3, bitrate };
  }
  return null;
}

describe.skipIf(!hasFfmpeg)('spite fallback with the real ffmpeg', () => {
  it('encodes the same 48 kHz stereo 256 kbps MP3 bytes twice', async () => {
    const once = async () => {
      const out = tempDir();
      for (const f of readdirSync(stems)) copyFileSync(join(stems, f), join(out, f));
      const r = await run(
        ['fallback', manifestCopy(), '--seed', '42', '--bars', '16', '--stems', out, '--update'],
        { SPITE_FFMPEG: undefined },
      );
      expect(r.code, r.stderr).toBe(0);
      const hash = /sha256:([0-9a-f]{64})/.exec(r.stdout)![1]!;
      return readFileSync(join(out, `${hash}.mp3`));
    };
    const a = await once();
    const b = await once();
    expect(sha256(a)).toBe(sha256(b));
    expect(firstFrame(a)).toEqual({ sampleRate: 48000, stereo: true, bitrate: 13 });
  });
});
