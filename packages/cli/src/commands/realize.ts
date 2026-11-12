import { canonicalTrace, realize } from '@spite-store/engine';
import { parse } from '../args.js';
import { EXIT_OK, UsageError, checkPinOrExit, loadManifest, positiveInt } from '../common.js';
import { clipNames, realizeByBar } from './sections.js';

export function realizeCommand(argv: string[]): number {
  const { values, positionals } = parse(argv, {
    seed: { type: 'string' },
    bars: { type: 'string' },
    json: { type: 'boolean' },
    'ignore-pin': { type: 'boolean' },
  });
  if (positionals.length !== 1) throw new UsageError('realize takes exactly one manifest');
  if (values.seed === undefined) throw new UsageError('realize needs --seed');
  const bars = positiveInt('bars', values.bars, 64);
  const file = positionals[0]!;
  const loaded = loadManifest(file);
  if (!('manifest' in loaded)) return loaded.exit;
  const { manifest } = loaded;
  const refused = checkPinOrExit(file, manifest, { ignore: values['ignore-pin'] });
  if (refused !== null) return refused;

  if (values.json) {
    console.log(canonicalTrace(realize(manifest, values.seed, { durationBars: bars })));
    return EXIT_OK;
  }

  const names = clipNames(manifest);
  const result = realizeByBar(manifest, values.seed, bars);
  const ended = result.endBar < bars ? `  ended at bar ${result.endBar}` : '';
  console.log(
    `${manifest.id}  seed ${JSON.stringify(values.seed)}  ${bars} bars  ${result.events.length} events${ended}`,
  );
  const width = Math.max(7, ...result.bars.map((b) => b.sectionId.length + 2));
  for (const b of result.bars) {
    if (b.events.length === 0 && !b.visitStart) continue;
    const section = (b.visitStart ? `> ${b.sectionId}` : '').padEnd(width);
    const events = b.events
      .map((e) => `${e.slot}=${names.get(e.clipHash) ?? e.clipHash}`)
      .join('  ');
    console.log(`${String(b.bar).padStart(4)}  ${section}  ${events}`.trimEnd());
  }
  return EXIT_OK;
}
