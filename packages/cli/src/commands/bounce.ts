import { writeFileSync } from 'node:fs';
import {
  SAMPLE_RATE,
  encodeWav16,
  planRender,
  realizeForRender,
  renderAll,
} from '@spite-store/engine';
import { parse } from '../args.js';
import { EXIT_OK, EXIT_USAGE, UsageError, loadManifest, positiveInt } from '../common.js';
import { DEFAULT_STEMS_DIR, loadStems, reportStemProblems } from '../stems.js';

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
  const { manifest } = loaded;

  const { events, endBar } = realizeForRender(manifest, values.seed, { durationBars: bars });
  const { stems, problems } = loadStems(
    manifest,
    events.map((e) => e.clipHash),
    values.stems ?? DEFAULT_STEMS_DIR,
  );
  if (problems.length > 0) {
    reportStemProblems(problems);
    return EXIT_USAGE;
  }
  const plan = planRender(manifest, events, endBar, stems);
  const { left, right } = renderAll(plan, stems);
  writeFileSync(values.out, encodeWav16([left, right]));
  console.log(
    `${values.out}  ${(plan.totalFrames / SAMPLE_RATE).toFixed(2)} s  ${events.length} events`,
  );
  return EXIT_OK;
}
