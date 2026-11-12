import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLE_RATE, type Fallback } from '@spite-store/engine';
import { parse } from '../args.js';
import {
  EXIT_INVALID,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  checkPinOrExit,
  loadManifest,
  positiveInt,
  rewriteJson,
  sha256,
} from '../common.js';
import { checkMp3Encoder, encodeMp3 } from '../encode.js';
import { renderSeedWav } from '../render.js';
import { DEFAULT_STEMS_DIR, reportStemProblems } from '../stems.js';

const describe = (f: Fallback | undefined): string =>
  f ? `seed ${JSON.stringify(f.seed)}, ${f.bars} bars, ${f.hash}` : 'none';

export async function fallbackCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, {
    seed: { type: 'string' },
    bars: { type: 'string' },
    stems: { type: 'string' },
    update: { type: 'boolean' },
  });
  if (positionals.length !== 1) throw new UsageError('fallback takes exactly one manifest');
  if (values.seed === undefined) throw new UsageError('fallback needs --seed');
  const bars = positiveInt('bars', values.bars, 64);
  const manifestFile = positionals[0]!;
  const loaded = loadManifest(manifestFile);
  if (!('manifest' in loaded)) return loaded.exit;
  const { manifest } = loaded;
  // A fallback is a recording of the pinned performance, so there is no --ignore-pin here.
  const refused = checkPinOrExit(manifestFile, manifest, { ignorable: false });
  if (refused !== null) return refused;

  const encoderProblem = checkMp3Encoder();
  if (encoderProblem) {
    console.error(encoderProblem);
    return EXIT_USAGE;
  }
  const stemsDir = values.stems ?? DEFAULT_STEMS_DIR;
  const rendered = renderSeedWav(manifest, values.seed, bars, stemsDir);
  if ('problems' in rendered) {
    reportStemProblems(rendered.problems);
    return EXIT_USAGE;
  }
  let mp3: Uint8Array;
  try {
    mp3 = encodeMp3(rendered.wav);
  } catch (error) {
    console.error((error as Error).message);
    return EXIT_USAGE;
  }
  const hash = sha256(mp3);
  mkdirSync(stemsDir, { recursive: true });
  const file = join(stemsDir, `${hash.slice('sha256:'.length)}.mp3`);
  writeFileSync(file, mp3);
  console.log(
    `${hash}  ${(rendered.frames / SAMPLE_RATE).toFixed(2)} s  ${(mp3.byteLength / 1e6).toFixed(2)} MB  ${file}`,
  );

  const next: Fallback = { hash, type: 'audio/mpeg', seed: values.seed, bars };
  const current = manifest.fallback;
  const same =
    current !== undefined &&
    current.hash === next.hash &&
    current.type === next.type &&
    current.seed === next.seed &&
    current.bars === next.bars;
  if (same) {
    console.log('fallback is up to date');
    return EXIT_OK;
  }
  if (values.update) {
    await rewriteJson(manifestFile, (m: { fallback?: Fallback }) => {
      m.fallback = next;
      return true;
    });
    console.log(`updated ${manifestFile}: fallback ${describe(next)}`);
    return EXIT_OK;
  }
  console.error(`recorded fallback: ${describe(current)}`);
  console.error(`new fallback:      ${describe(next)}`);
  console.error('the fallback differs; rerun with --update to record it');
  return EXIT_INVALID;
}
