import { isAbsolute } from 'node:path';
import { barFrame, type Manifest } from '@spite-store/engine';
import { readWavLayout, type WavLayout } from './wavslice.js';

/** `pack.json`: which bar ranges of which source recordings become which clips. */
export interface PackFile {
  sources: Record<string, { file: string; sha256: string }>;
  clips: Record<string, { source: string; startBar: number; bars: number }>;
}

/** A source recording as read from disk. */
export interface SourceAudio {
  bytes: Uint8Array;
  /** `sha256:<hex>` of the file's bytes. */
  sha256: string;
}

/** One clip's slice: frames `[start, end)` of a source. */
export interface Slice {
  clip: string;
  source: string;
  start: number;
  end: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const sortedEntries = (o: Record<string, unknown>) =>
  Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const isWholeNumber = (v: unknown, min: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min;

/**
 * Checks a parsed pack file's structure and its coverage of the manifest's clip catalogue.
 * Returns the problems found, each a plain-language line; an empty list means it is usable.
 */
export function checkPackFile(data: unknown, manifest: Manifest): string[] {
  const problems: string[] = [];
  if (!isRecord(data) || !isRecord(data.sources) || !isRecord(data.clips)) {
    return ['pack file must be an object with "sources" and "clips" objects'];
  }
  for (const [name, source] of sortedEntries(data.sources)) {
    if (!isRecord(source) || typeof source.file !== 'string' || typeof source.sha256 !== 'string') {
      problems.push(`source "${name}" needs a "file" path and a "sha256"`);
    } else if (isAbsolute(source.file)) {
      problems.push(
        `source "${name}" has an absolute path "${source.file}": use a path relative to --source`,
      );
    }
  }
  for (const [id, entry] of sortedEntries(data.clips)) {
    if (!(id in manifest.clips)) {
      problems.push(`pack entry "${id}" names a clip that is not in the manifest`);
      continue;
    }
    if (!isRecord(entry) || typeof entry.source !== 'string') {
      problems.push(`pack entry "${id}" needs a "source"`);
      continue;
    }
    if (!(entry.source in data.sources)) {
      problems.push(`pack entry "${id}" names unknown source "${entry.source}"`);
    }
    if (!isWholeNumber(entry.startBar, 0)) {
      problems.push(`pack entry "${id}" needs "startBar" as a whole number of at least 0`);
    }
    if (!isWholeNumber(entry.bars, 1)) {
      problems.push(`pack entry "${id}" needs "bars" as a whole number of at least 1`);
    } else if (entry.bars < manifest.clips[id]!.lengthBars) {
      problems.push(
        `pack entry "${id}" slices ${entry.bars} bar(s), shorter than the clip's lengthBars ${manifest.clips[id]!.lengthBars}`,
      );
    }
  }
  for (const id of Object.keys(manifest.clips).sort()) {
    if (!(id in data.clips)) problems.push(`clip "${id}" has no pack entry`);
  }
  return problems;
}

/**
 * Works out every clip's frame range from the manifest's tempo map (exactly as the renderer places
 * bars) and checks it against its source's audio. Sources must already have passed
 * `readWavLayout`. Returns the slices, or the problems that prevent packing.
 */
export function planSlices(
  pack: PackFile,
  manifest: Manifest,
  layouts: ReadonlyMap<string, WavLayout>,
): { slices: Slice[]; problems: string[] } {
  const slices: Slice[] = [];
  const problems: string[] = [];
  for (const clip of Object.keys(pack.clips).sort()) {
    const { source, startBar, bars } = pack.clips[clip]!;
    const start = barFrame(manifest, startBar);
    const end = barFrame(manifest, startBar + bars);
    const layout = layouts.get(source)!;
    if (end > layout.frames) {
      problems.push(
        `pack entry "${clip}" needs frames ${start}-${end} but source "${source}" has only ${layout.frames} frames`,
      );
    } else {
      slices.push({ clip, source, start, end });
    }
  }
  return { slices, problems };
}

/** Reads each source's layout, collecting format problems by source name. */
export function readLayouts(sources: ReadonlyMap<string, SourceAudio>): {
  layouts: Map<string, WavLayout>;
  problems: string[];
} {
  const layouts = new Map<string, WavLayout>();
  const problems: string[] = [];
  for (const [name, audio] of sources) {
    try {
      layouts.set(name, readWavLayout(audio.bytes));
    } catch (error) {
      problems.push(`source "${name}": ${(error as Error).message}`);
    }
  }
  return { layouts, problems };
}
