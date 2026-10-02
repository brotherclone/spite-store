import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RENDER_FORMAT, barFrame, renderWav } from '../../src/index.js';
import { loadPlaceholder, placeholderStems, repoRoot, sha256 } from '../helpers/placeholder.js';

interface AudioSnapshot {
  seed: string | number;
  durationBars: number;
  renderFormat: number;
  frames: number;
  wavSha256: string;
  barSha256: string[];
}

describe('golden audio', () => {
  const { manifest } = loadPlaceholder();
  const stems = placeholderStems();

  it.each(['0', '42', 'spite-store'])('placeholder.audio.%s.json matches', (name) => {
    const snapshot = JSON.parse(
      readFileSync(join(repoRoot, 'fixtures/golden', `placeholder.audio.${name}.json`), 'utf8'),
    ) as AudioSnapshot;
    expect(snapshot.renderFormat, 'renderFormat changed: regenerate with pnpm golden:update').toBe(
      RENDER_FORMAT,
    );
    const { wav, frames, endBar } = renderWav(
      manifest,
      snapshot.seed,
      { durationBars: snapshot.durationBars },
      stems,
    );
    if (sha256(wav) === snapshot.wavSha256) return;

    const bounds = Array.from({ length: endBar + 1 }, (_, b) => barFrame(manifest, b)).concat(
      frames,
    );
    const bars = bounds
      .slice(0, -1)
      .map((from, i) => sha256(wav.subarray(44 + from * 4, 44 + bounds[i + 1]! * 4)));
    const first = bars.findIndex((h, i) => h !== snapshot.barSha256[i]);
    const where =
      first === -1
        ? `frame count ${frames} vs ${snapshot.frames}`
        : first === endBar
          ? 'the tail after the last bar'
          : `bar ${first}`;
    expect.fail(
      `Golden audio drift for seed ${JSON.stringify(snapshot.seed)}: first difference in ${where}. ` +
        'If intended, bump RENDER_FORMAT and run pnpm golden:update.',
    );
  });
});
