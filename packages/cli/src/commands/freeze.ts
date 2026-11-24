import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { checkPin, describePinMismatch, type Manifest } from '@spite-store/engine';
import { parse } from '../args.js';
import {
  EXIT_INVALID,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  checkPinOrExit,
  loadManifest,
  sha256,
} from '../common.js';
import {
  blobStore,
  checkReachable,
  collectFiles,
  manifestFile,
  readLocalFiles,
  uploadMissing,
  type PublishFile,
  type StemStore,
  type UploadResult,
} from '../publish.js';
import { DEFAULT_STEMS_DIR } from '../stems.js';
import { validateManifest } from '../validate.js';
import {
  VERSIONS_FILE,
  formatVersions,
  labelProblem,
  nextLabel,
  parseVersions,
  type VersionEntry,
} from '../versions.js';

export interface FreezeDeps {
  store?: (token: string) => Promise<StemStore>;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

const describeFile = (file: PublishFile) => `${file.owners.join(', ')}  ${file.hash}`;

/**
 * Reads a piece's version list. A missing file is an unfrozen piece (no entries); an invalid one
 * is printed, naming the file, and returned as null.
 */
function readVersions(pieceDir: string): VersionEntry[] | null {
  const file = join(pieceDir, VERSIONS_FILE);
  if (!existsSync(file)) return [];
  const parsed = parseVersions(readFileSync(file, 'utf8'));
  if ('entries' in parsed) return parsed.entries;
  for (const problem of parsed.problems) console.error(`${file}  ${problem}`);
  return null;
}

export async function freezeCommand(argv: string[], deps: FreezeDeps = {}): Promise<number> {
  const { values, positionals } = parse(argv, {
    label: { type: 'string' },
    stems: { type: 'string' },
    check: { type: 'string' },
  });
  if (values.check !== undefined) {
    if (!/^https?:\/\//.test(values.check)) {
      throw new UsageError('--check needs the store base URL, e.g. https://<store>/stems/');
    }
    if (positionals.length === 0)
      throw new UsageError('freeze --check takes one or more manifests');
    if (values.label !== undefined) throw new UsageError('--label cannot be used with --check');
    const base = values.check.endsWith('/') ? values.check : `${values.check}/`;
    return checkVersions(positionals, base, deps.fetch ?? fetch);
  }
  if (positionals.length !== 1) throw new UsageError('freeze takes exactly one manifest');
  return freeze(positionals[0]!, values.label, values.stems ?? DEFAULT_STEMS_DIR, deps);
}

async function freeze(
  file: string,
  label: string | undefined,
  stemsDir: string,
  deps: FreezeDeps,
): Promise<number> {
  const loaded = loadManifest(file);
  if (!('manifest' in loaded)) return loaded.exit;
  const { manifest } = loaded;
  const pieceDir = dirname(resolve(file));

  const dirName = basename(pieceDir);
  if (manifest.id !== dirName) {
    console.error(
      `${file}  /id  the manifest's id is "${manifest.id}" but its directory is "${dirName}"; they must match`,
    );
    return EXIT_INVALID;
  }
  if (manifest.engine === undefined) {
    console.error(`${file}  not pinned; run spite pin --update before freezing`);
    return EXIT_INVALID;
  }
  const pinExit = checkPinOrExit(file, manifest, { ignorable: false });
  if (pinExit !== null) return pinExit;
  if (label !== undefined) {
    const problem = labelProblem(label);
    if (problem) {
      console.error(`--label  ${problem}`);
      return EXIT_USAGE;
    }
  }

  const versions = readVersions(pieceDir);
  if (versions === null) return EXIT_INVALID;
  const bytes = new Uint8Array(readFileSync(file));
  const own = manifestFile(bytes);
  const recorded = versions.find((v) => v.hash === own.hash);
  if (recorded && label !== undefined && label !== recorded.label) {
    console.error(
      `${file}  this version is already labelled "${recorded.label}" (${own.hash}); labels never change`,
    );
    return EXIT_INVALID;
  }
  if (!recorded && label !== undefined && versions.some((v) => v.label === label)) {
    console.error(`--label  "${label}" is taken by another version of ${manifest.id}`);
    return EXIT_INVALID;
  }

  const files = collectFiles([manifest]);
  const local = readLocalFiles(files, stemsDir);
  if (local.problems.length > 0) {
    for (const p of local.problems) console.error(`${describeFile(p.file)}  ${p.reason}`);
    console.error(`${local.problems.length} file(s) unavailable; nothing frozen`);
    return EXIT_USAGE;
  }
  const token = (deps.env ?? process.env).BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error(
      'BLOB_READ_WRITE_TOKEN is not set; export it, or run with node --env-file=.env.local',
    );
    return EXIT_USAGE;
  }

  // Local copy first, then everything it references, then the manifest, and the record last, so
  // a failure at any point leaves either nothing recorded or a complete version.
  writeFileSync(join(stemsDir, own.name), bytes);
  const store = await (deps.store ?? blobStore)(token);
  const results: UploadResult[] = await uploadMissing(files, local.bytes, store);
  if (!results.some((r) => r.status === 'failed')) {
    results.push(...(await uploadMissing([own], new Map([[own.name, bytes]]), store)));
  }
  for (const r of results) {
    if (r.status === 'uploaded')
      console.log(`uploaded  ${r.file.name}  ${r.file.owners.join(', ')}`);
    if (r.status === 'failed') console.error(`failed  ${describeFile(r.file)}  ${r.reason}`);
  }
  const failed = results.filter((r) => r.status === 'failed').length;
  if (failed > 0) {
    console.error(`${failed} upload(s) failed; ${VERSIONS_FILE} unchanged, nothing frozen`);
    return EXIT_INVALID;
  }

  if (recorded) {
    console.log(`${manifest.id}  ${recorded.label}  ${own.hash}  (already frozen)`);
    return EXIT_OK;
  }
  const entry = { hash: own.hash, label: label ?? nextLabel(versions) };
  writeFileSync(join(pieceDir, VERSIONS_FILE), formatVersions([...versions, entry]));
  console.log(`${manifest.id}  ${entry.label}  ${entry.hash}  frozen`);
  return EXIT_OK;
}

/** Fetches `url`, retrying once on a network error or a server error. */
async function fetchBytes(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ bytes: Uint8Array } | { reason: string }> {
  let reason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return { bytes: new Uint8Array(await response.arrayBuffer()) };
      reason = `HTTP ${response.status}`;
      if (response.status < 500) break;
    } catch (error) {
      reason = (error as Error).message;
    }
  }
  return { reason };
}

async function checkVersions(
  manifestPaths: readonly string[],
  base: string,
  fetchImpl: typeof fetch,
): Promise<number> {
  let failures = 0;
  const fail = (line: string) => {
    console.error(line);
    failures++;
  };
  let checked = 0;
  for (const path of manifestPaths) {
    const loaded = loadManifest(path);
    if (!('manifest' in loaded)) {
      failures++;
      continue;
    }
    const piece = loaded.manifest.id;
    const versions = readVersions(dirname(resolve(path)));
    if (versions === null) {
      failures++;
      continue;
    }
    if (versions.length === 0) {
      console.log(`unfrozen  ${piece}`);
      continue;
    }
    for (const { hash, label } of versions) {
      checked++;
      const where = `${piece}  ${label}  ${hash}`;
      const hex = hash.slice('sha256:'.length);
      const fetched = await fetchBytes(`${base}${hex}.json`, fetchImpl);
      if ('reason' in fetched) {
        fail(`missing  ${where}  ${hex}.json unreachable (${fetched.reason})`);
        continue;
      }
      if (sha256(fetched.bytes) !== hash) {
        fail(`mismatch  ${where}  the stored ${hex}.json does not hash to its name`);
        continue;
      }
      let frozen: Manifest;
      try {
        const data: unknown = JSON.parse(new TextDecoder().decode(fetched.bytes));
        const errors = validateManifest(data);
        if (errors.length > 0) {
          const first = errors[0]!;
          fail(`invalid  ${where}  ${first.pointer || '(root)'}  ${first.message}`);
          continue;
        }
        frozen = data as Manifest;
      } catch (error) {
        fail(`invalid  ${where}  not valid JSON (${(error as Error).message})`);
        continue;
      }
      if (frozen.id !== piece) {
        fail(`invalid  ${where}  the frozen manifest's id is "${frozen.id}"`);
        continue;
      }
      for (const m of checkPin(frozen)) {
        console.error(
          `warning: stranded  ${where}  /engine/${m.format}  ${describePinMismatch(m)}`,
        );
      }
      const files = collectFiles([frozen]);
      const reach = await checkReachable(files, base, fetchImpl);
      const missing = reach.filter((r) => !r.reachable);
      for (const r of missing) {
        fail(`unreachable  ${where}  ${describeFile(r.file)}  ${r.reason}`);
      }
      if (missing.length === 0) {
        console.log(`reachable  ${where}  (${files.length} file(s))`);
      }
    }
  }
  if (failures > 0) {
    console.error(`${failures} problem(s) with frozen versions at ${base}`);
    return EXIT_INVALID;
  }
  console.log(`all ${checked} frozen version(s) reachable at ${base}`);
  return EXIT_OK;
}
