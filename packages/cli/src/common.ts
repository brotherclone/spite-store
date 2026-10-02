import { readFileSync } from 'node:fs';
import type { Manifest } from '@spite-store/engine';
import { validateManifest } from './validate.js';

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

export const USAGE = `Usage: spite <command> [args]

Commands:
  validate <manifest.json...>
      Check manifests against the schema and semantic rules.
  realize <manifest.json> --seed <seed> [--bars 64] [--json]
      Print the event trace for a seed.
  bounce <manifest.json> --seed <seed> -o <out.wav> [--bars 64] [--stems .stems]
      Render one seed to a 16-bit 48 kHz stereo WAV file.
  audition <manifest.json> [--seeds 4 | --seed <seed>...] [--bars 16] [--stems .stems]
           [--out <reel.wav>] [--no-play]
      Render several seeds into one reel (2 s apart) and play it (afplay, macOS).
  pack
      (not implemented yet)

Exit codes: 0 success, 1 invalid manifest, 2 usage error, unreadable file or missing stem.`;

/** Thrown for bad command-line usage; reported with the usage text and exit code 2. */
export class UsageError extends Error {}

/** Reads, parses and validates a manifest, printing problems. Returns the manifest or an exit code. */
export function loadManifest(file: string): { manifest: Manifest } | { exit: number } {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const reason =
      error instanceof SyntaxError
        ? `not valid JSON (${error.message})`
        : (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'no such file'
          : String(error);
    console.error(`${file}  error: ${reason}`);
    return { exit: EXIT_USAGE };
  }
  const errors = validateManifest(data);
  if (errors.length > 0) {
    for (const e of errors) console.log(`${file}  ${e.pointer || '(root)'}  ${e.message}`);
    return { exit: EXIT_INVALID };
  }
  return { manifest: data as Manifest };
}

/** Parses a positive integer flag value. */
export function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1) {
    throw new UsageError(`--${name} must be a positive integer, got "${value}"`);
  }
  return n;
}
