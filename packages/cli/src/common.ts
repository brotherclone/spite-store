import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkPin, describePinMismatch, type Manifest } from '@spite-store/engine';
import { validateManifest } from './validate.js';

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_USAGE = 2;

export const USAGE = `Usage: spite <command> [args]

Commands:
  validate <manifest.json...>
      Check manifests against the schema and semantic rules.
  realize <manifest.json> --seed <seed> [--bars 64] [--json] [--ignore-pin]
      Print the event trace for a seed.
  bounce <manifest.json> --seed <seed> -o <out.wav> [--bars 64] [--stems .stems] [--ignore-pin]
      Render one seed to a 16-bit 48 kHz stereo WAV file.
  audition <manifest.json> [--seeds 4 | --seed <seed>...] [--bars 16] [--stems .stems]
           [--out <reel.wav>] [--no-play] [--ignore-pin]
      Render several seeds into one reel (2 s apart) and play it (afplay, macOS).
  pack <manifest.json> --source <dir> [--stems .stems] [--update]
      Cut the clips listed in the pack.json beside the manifest from recordings under --source
      into stems, and check (or with --update, rewrite) the manifest's clip hashes.
  fallback <manifest.json> --seed <seed> [--bars 64] [--stems .stems] [--update]
      Render one seed, encode it to MP3 with ffmpeg into the stems directory by hash, and check
      (or with --update, record) the manifest's fallback.
  publish <manifest.json...> [--stems .stems]
      Upload every stem and fallback the manifests reference to the public store, by hash,
      skipping files already there. Needs BLOB_READ_WRITE_TOKEN.
  publish --check <base-url> <manifest.json...>
      Upload nothing; check that every referenced file is reachable at <base-url><hex>.<ext>.
  pin <manifest.json> [--update]
      Check that the manifest is pinned to this engine's trace and render formats, or with
      --update, pin it to them. realize, bounce and audition refuse a manifest pinned to other
      formats unless given --ignore-pin; fallback always refuses.

Exit codes: 0 success, 1 invalid manifest, changed hashes, a missing or mismatched engine pin,
unreachable or failed uploads, 2 usage error, unreadable file, missing stem, unusable source, missing ffmpeg or token.`;

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

export const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** Formats JSON with the repository's Prettier config when Prettier can be resolved. */
export async function formatJson(text: string, file: string): Promise<string> {
  try {
    const name = 'prettier';
    const prettier = (await import(name)) as typeof import('prettier');
    const options = (await prettier.resolveConfig(file)) ?? {};
    return await prettier.format(text, { ...options, filepath: file });
  } catch {
    return text;
  }
}

/** Rewrites a JSON file through `edit`, leaving the file alone when `edit` reports no change. */
export async function rewriteJson(file: string, edit: (data: never) => boolean): Promise<boolean> {
  const data = JSON.parse(readFileSync(file, 'utf8')) as never;
  if (!edit(data)) return false;
  writeFileSync(file, await formatJson(JSON.stringify(data, null, 2) + '\n', file));
  return true;
}

/**
 * Refuses a manifest pinned to engine formats other than this engine's. Prints one line per
 * differing format, laid out like validation errors, and returns the exit code; returns null when
 * the manifest may be played. With `ignore` the lines become warnings and the command carries on.
 * `ignorable` says whether the command accepts --ignore-pin, so the hint is only shown where it works.
 */
export function checkPinOrExit(
  file: string,
  manifest: Manifest,
  { ignore = false, ignorable = true }: { ignore?: boolean; ignorable?: boolean } = {},
): number | null {
  const mismatches = checkPin(manifest);
  if (mismatches.length === 0) return null;
  const prefix = ignore ? 'warning: ' : '';
  for (const m of mismatches) {
    console.error(`${prefix}${file}  /engine/${m.format}  ${describePinMismatch(m)}`);
  }
  if (ignore) {
    console.error(`${prefix}${file}  playing this engine's version, not the pinned performance`);
    return null;
  }
  if (ignorable) console.error(`${file}  use --ignore-pin to hear this engine's version anyway`);
  return EXIT_INVALID;
}
