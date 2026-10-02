import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SAMPLE_RATE,
  encodeWav16,
  planRender,
  renderAll,
  type RenderPlan,
} from '@spite-store/engine';
import { parse } from '../args.js';
import { EXIT_OK, EXIT_USAGE, UsageError, loadManifest, positiveInt } from '../common.js';
import { DEFAULT_STEMS_DIR, loadStems, reportStemProblems } from '../stems.js';
import { realizeByBar, sectionSummary } from './sections.js';

/** Silence between performances in a reel: 2 seconds. */
export const GAP_FRAMES = 2 * SAMPLE_RATE;

const clock = (frames: number): string => {
  const seconds = frames / SAMPLE_RATE;
  const m = Math.floor(seconds / 60);
  return `${m}:${(seconds - m * 60).toFixed(1).padStart(4, '0')}`;
};

function play(file: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('afplay', [file], { stdio: 'inherit' });
    child.on('error', (error) => {
      console.error(`could not run afplay: ${error.message}`);
      resolve(EXIT_USAGE);
    });
    child.on('exit', (code) => resolve(code ?? EXIT_OK));
  });
}

export async function auditionCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, {
    seeds: { type: 'string' },
    seed: { type: 'string', multiple: true },
    bars: { type: 'string' },
    stems: { type: 'string' },
    out: { type: 'string', short: 'o' },
    'no-play': { type: 'boolean' },
  });
  if (positionals.length !== 1) throw new UsageError('audition takes exactly one manifest');
  if (values.seed !== undefined && values.seeds !== undefined) {
    throw new UsageError('use either --seeds <k> or --seed <seed>..., not both');
  }
  const bars = positiveInt('bars', values.bars, 16);
  const seeds =
    values.seed ??
    Array.from({ length: positiveInt('seeds', values.seeds, 4) }, (_, i) => String(i));
  const loaded = loadManifest(positionals[0]!);
  if (!('manifest' in loaded)) return loaded.exit;
  const { manifest } = loaded;

  const takes = seeds.map((seed) => ({ seed, ...realizeByBar(manifest, seed, bars) }));
  const { stems, problems } = loadStems(
    manifest,
    takes.flatMap((t) => t.events.map((e) => e.clipHash)),
    values.stems ?? DEFAULT_STEMS_DIR,
  );
  if (problems.length > 0) {
    reportStemProblems(problems);
    return EXIT_USAGE;
  }

  const renders = takes.map((t) => {
    const plan: RenderPlan = planRender(manifest, t.events, t.endBar, stems);
    return { take: t, plan, ...renderAll(plan, stems) };
  });
  const total =
    renders.reduce((n, r) => n + r.plan.totalFrames, 0) + GAP_FRAMES * (renders.length - 1);
  const left = new Float64Array(total);
  const right = new Float64Array(total);
  let offset = 0;
  console.log(`${manifest.id}  ${renders.length} seeds  ${bars} bars each`);
  for (const r of renders) {
    left.set(r.left, offset);
    right.set(r.right, offset);
    const summary = sectionSummary(r.take.visits, r.take.endBar, bars);
    console.log(
      `  ${clock(offset)}  seed ${JSON.stringify(r.take.seed)}  ${r.take.events.length} events  ${summary}`,
    );
    offset += r.plan.totalFrames + GAP_FRAMES;
  }

  const wav = encodeWav16([left, right]);
  const file =
    values.out ??
    join(
      tmpdir(),
      `spite-audition-${manifest.id}-${createHash('sha256').update(wav).digest('hex').slice(0, 8)}.wav`,
    );
  writeFileSync(file, wav);
  console.log(`${file}  ${clock(total)}`);

  if (values['no-play'] || process.platform !== 'darwin') return EXIT_OK;
  return play(file);
}
