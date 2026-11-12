import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { ENGINE_FORMATS, checkPin, describePinMismatch } from '@spite-store/engine';
import { parse } from '../args.js';
import {
  EXIT_INVALID,
  EXIT_OK,
  UsageError,
  formatJson,
  loadManifest,
  rewriteJson,
} from '../common.js';

const formats = (f: { trace: number; render: number }) => `trace ${f.trace}, render ${f.render}`;

/**
 * Writes the pin into the manifest's text, so the rest of the file keeps its formatting: replaces
 * an existing `engine` object, or inserts one on the line after `specVersion`. Returns null when
 * the text doesn't have the expected shape.
 */
function editPinText(text: string): string | null {
  const pin = `{ "trace": ${ENGINE_FORMATS.trace}, "render": ${ENGINE_FORMATS.render} }`;
  const existing = /("engine"\s*:\s*)\{[^{}]*\}/;
  if (existing.test(text)) return text.replace(existing, (_, key: string) => key + pin);
  const spec = /^([ \t]*)"specVersion"\s*:\s*"[^"\n]*"\s*,[ \t]*$/m.exec(text);
  if (!spec) return null;
  const end = spec.index + spec[0].length;
  return `${text.slice(0, end)}\n${spec[1]}"engine": ${pin},${text.slice(end)}`;
}

/** Sets `engine` on a parsed manifest object, directly after `specVersion`, keeping key order. */
function placePin(data: Record<string, unknown>): void {
  const entries = Object.entries(data).filter(([key]) => key !== 'engine');
  for (const key of Object.keys(data)) delete data[key];
  for (const [key, value] of entries) {
    data[key] = value;
    if (key === 'specVersion') data.engine = { ...ENGINE_FORMATS };
  }
  if (!('engine' in data)) data.engine = { ...ENGINE_FORMATS };
}

export async function pinCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, { update: { type: 'boolean' } });
  if (positionals.length !== 1) throw new UsageError('pin takes exactly one manifest');
  const file = positionals[0]!;
  const loaded = loadManifest(file);
  if (!('manifest' in loaded)) return loaded.exit;
  const { manifest } = loaded;
  const mismatches = checkPin(manifest);
  const current = `${file}  pinned to ${formats(ENGINE_FORMATS)} (current)`;

  if (manifest.engine !== undefined && mismatches.length === 0) {
    console.log(current);
    return EXIT_OK;
  }
  if (!values.update) {
    if (manifest.engine === undefined) {
      console.error(
        `${file}  not pinned (this engine: ${formats(ENGINE_FORMATS)}); run with --update to pin`,
      );
    } else {
      for (const m of mismatches) {
        console.error(`${file}  /engine/${m.format}  ${describePinMismatch(m)}`);
      }
    }
    return EXIT_INVALID;
  }

  const text = readFileSync(file, 'utf8');
  const edited = editPinText(text);
  let parsed: unknown;
  try {
    parsed = edited === null ? null : JSON.parse(edited);
  } catch {
    parsed = null;
  }
  if (isDeepStrictEqual(parsed, { ...JSON.parse(text), engine: { ...ENGINE_FORMATS } })) {
    writeFileSync(file, await formatJson(edited!, file));
  } else {
    // An unusual layout: rewrite the whole file instead, which may reflow other fields.
    await rewriteJson(file, (data: Record<string, unknown>) => {
      placePin(data);
      return true;
    });
  }
  if (manifest.engine !== undefined) {
    console.error(
      `warning: ${file}  re-pinned from ${formats(manifest.engine)}; existing seed links to this piece will play a different performance`,
    );
  }
  console.log(current);
  return EXIT_OK;
}
