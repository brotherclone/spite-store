import { spawnSync } from 'node:child_process';

/** The ffmpeg executable: `ffmpeg` on PATH, or `SPITE_FFMPEG` (used by tests). */
export const ffmpegCommand = (): string => process.env.SPITE_FFMPEG ?? 'ffmpeg';

const MISSING = 'spite fallback needs ffmpeg with MP3 support (libmp3lame) on PATH';

/** Returns null when ffmpeg can encode MP3, or a message saying why it can't. */
export function checkMp3Encoder(command = ffmpegCommand()): string | null {
  const result = spawnSync(command, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return `${MISSING}; could not run "${command}"`;
  if (!/\blibmp3lame\b/.test(result.stdout)) return `${MISSING}; "${command}" has no libmp3lame`;
  return null;
}

/**
 * Encodes a 48 kHz stereo WAV to 256 kbps CBR MP3. Metadata and the encoder-version tag are
 * stripped, so one ffmpeg build gives the same bytes every time. Other builds may not.
 */
export function encodeMp3(wav: Uint8Array, command = ffmpegCommand()): Uint8Array {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'wav',
    '-i',
    'pipe:0',
    '-map_metadata',
    '-1',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-codec:a',
    'libmp3lame',
    '-b:a',
    '256k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-f',
    'mp3',
    'pipe:1',
  ];
  const result = spawnSync(command, args, { input: wav, maxBuffer: 512 * 1024 * 1024 });
  if (result.error) throw new Error(`ffmpeg failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with ${result.status}: ${result.stderr.toString().trim()}`);
  }
  return new Uint8Array(result.stdout.buffer, result.stdout.byteOffset, result.stdout.byteLength);
}
