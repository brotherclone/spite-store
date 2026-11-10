import type { Manifest } from '@spite-store/engine';
import { parse } from '../args.js';
import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, UsageError, loadManifest } from '../common.js';
import {
  blobStore,
  checkReachable,
  collectFiles,
  readLocalFiles,
  uploadMissing,
  type PublishFile,
  type StemStore,
} from '../publish.js';
import { DEFAULT_STEMS_DIR } from '../stems.js';

export interface PublishDeps {
  store?: (token: string) => Promise<StemStore>;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

const label = (file: PublishFile) => `${file.owners.join(', ')}  ${file.hash}`;

export async function publishCommand(argv: string[], deps: PublishDeps = {}): Promise<number> {
  const { values, positionals } = parse(argv, {
    stems: { type: 'string' },
    check: { type: 'string' },
  });
  if (positionals.length === 0) throw new UsageError('publish takes one or more manifests');
  if (values.check !== undefined && !/^https?:\/\//.test(values.check)) {
    throw new UsageError('--check needs the store base URL, e.g. https://<store>/stems/');
  }

  const manifests: Manifest[] = [];
  let invalid = false;
  for (const file of positionals) {
    const loaded = loadManifest(file);
    if ('manifest' in loaded) manifests.push(loaded.manifest);
    else if (loaded.exit === EXIT_USAGE) return EXIT_USAGE;
    else invalid = true;
  }
  if (invalid) return EXIT_INVALID;
  const files = collectFiles(manifests);

  if (values.check !== undefined) {
    const base = values.check.endsWith('/') ? values.check : `${values.check}/`;
    const results = await checkReachable(files, base, deps.fetch);
    const missing = results.filter((r) => !r.reachable);
    for (const r of missing) console.error(`unreachable  ${label(r.file)}  ${r.reason}`);
    if (missing.length > 0) {
      console.error(`${missing.length} of ${files.length} file(s) unreachable at ${base}`);
      return EXIT_INVALID;
    }
    console.log(`all ${files.length} file(s) reachable at ${base}`);
    return EXIT_OK;
  }

  const stemsDir = values.stems ?? DEFAULT_STEMS_DIR;
  const { bytes, problems } = readLocalFiles(files, stemsDir);
  if (problems.length > 0) {
    for (const p of problems) console.error(`${label(p.file)}  ${p.reason}`);
    console.error(`${problems.length} file(s) unavailable; nothing uploaded`);
    return EXIT_USAGE;
  }
  const token = (deps.env ?? process.env).BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error(
      'BLOB_READ_WRITE_TOKEN is not set; export it, or run with node --env-file=.env.local',
    );
    return EXIT_USAGE;
  }

  const store = await (deps.store ?? blobStore)(token);
  const results = await uploadMissing(files, bytes, store);
  for (const r of results) {
    if (r.status === 'uploaded')
      console.log(`uploaded  ${r.file.name}  ${r.file.owners.join(', ')}`);
    if (r.status === 'failed') console.error(`failed  ${label(r.file)}  ${r.reason}`);
  }
  const count = (status: string) => results.filter((r) => r.status === status).length;
  console.log(
    `${count('uploaded')} uploaded, ${count('present')} already present` +
      (count('failed') > 0 ? `, ${count('failed')} failed` : ''),
  );
  return count('failed') > 0 ? EXIT_INVALID : EXIT_OK;
}
