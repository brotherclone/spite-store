import { writeFileSync } from 'node:fs';
import { SAMPLE_RATE } from '@spite-store/engine';
import { parse } from '../args.js';
import { EXIT_OK, EXIT_USAGE, UsageError, loadManifest, positiveInt } from '../common.js';
import { renderSeedWav } from '../render.js';
import { DEFAULT_STEMS_DIR, reportStemProblems } from '../stems.js';

export function bounceCommand(argv: string[]): number {
  const { values, positionals } = parse(argv, {
    seed: { type: 'string' },
    bars: { type: 'string' },
    out: { type: 'string', short: 'o' },
    stems: { type: 'string' },
  });
  if (positionals.length !== 1) throw new UsageError('bounce takes exactly one manifest');
  if (values.seed === undefined) throw new UsageError('bounce needs --seed');
  if (values.out === undefined) throw new UsageError('bounce needs -o <out.wav>');
  const bars = positiveInt('bars', values.bars, 64);
  const loaded = loadManifest(positionals[0]!);
  if (!('manifest' in loaded)) return loaded.exit;

  const rendered = renderSeedWav(
    loaded.manifest,
    values.seed,
    bars,
    values.stems ?? DEFAULT_STEMS_DIR,
  );
  if ('problems' in rendered) {
    reportStemProblems(rendered.problems);
    return EXIT_USAGE;
  }
  writeFileSync(values.out, rendered.wav);
  console.log(
    `${values.out}  ${(rendered.frames / SAMPLE_RATE).toFixed(2)} s  ${rendered.events} events`,
  );
  return EXIT_OK;
}
