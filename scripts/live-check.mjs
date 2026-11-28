// Checks a deployed site's /stems/ proxy after a deploy:
//   node scripts/live-check.mjs https://spite-store.vercel.app
// The build can't do this, since it runs before its deployment is live. For every frozen manifest,
// every track's audio and each piece's first stem, it sends a range request and then a plain one,
// both to the file's URL with a fresh ?probe= query, so the real URL's cache entry is never touched.
// The range request must answer 206, and the plain one 200 with bytes that hash to the file's name:
// an edge cache that stored the 206 under the URL fails this. A track's audio must also be served
// without a filename in Content-Disposition, so the page's download name applies.
// SPITE_PIECES_DIR overrides the pieces directory. For a protected preview, set
// VERCEL_AUTOMATION_BYPASS_SECRET to the project's protection bypass secret.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = join(import.meta.dirname, '..');
const HASH = /^sha256:([0-9a-f]{64})$/;

const origin = process.argv[2];
if (!origin || !/^https?:\/\//.test(origin)) {
  console.error(
    'usage: node scripts/live-check.mjs <site origin, e.g. https://spite-store.vercel.app>',
  );
  process.exit(2);
}
const base = `${origin.replace(/\/+$/, '')}/stems/`;
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
  : {};

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
const hexOf = (hash) => HASH.exec(hash ?? '')?.[1];

/** The files to probe, as { file, label, track }. */
function targets(piecesDir) {
  const found = new Map();
  const add = (hex, ext, label, track = false) => {
    if (hex && !found.has(`${hex}.${ext}`))
      found.set(`${hex}.${ext}`, { file: `${hex}.${ext}`, label, track });
  };
  for (const entry of readdirSync(piecesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(piecesDir, entry.name);
    const manifest = readJson(join(dir, 'manifest.json'));
    if (!manifest) continue;
    const firstClip = Object.entries(manifest.clips ?? {}).sort(([a], [b]) =>
      a.localeCompare(b),
    )[0];
    if (firstClip) add(hexOf(firstClip[1].hash), 'flac', `${entry.name}  stem ${firstClip[0]}`);
    for (const v of readJson(join(dir, 'versions.json'))?.versions ?? [])
      add(hexOf(v.hash), 'json', `${entry.name}  ${v.label}`);
    for (const t of readJson(join(dir, 'release.json'))?.tracks ?? [])
      add(hexOf(t.audio), 'flac', `${entry.name}  track:${t.id}`, true);
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** The problems with one file, or [] when its proxy behaves. */
async function probe({ file, track }) {
  const url = `${base}${file}?probe=${randomBytes(8).toString('hex')}`;
  const problems = [];
  const ranged = await fetch(url, { headers: { ...headers, range: 'bytes=100-199' } });
  await ranged.arrayBuffer();
  if (ranged.status !== 206) problems.push(`range request answered ${ranged.status}, not 206`);
  const plain = await fetch(url, { headers });
  const body = Buffer.from(await plain.arrayBuffer());
  if (plain.status !== 200) {
    problems.push(
      `plain request after a range request answered ${plain.status}, not 200${plain.status === 206 ? ': an edge cache is serving a stored partial response as the whole file' : ''}`,
    );
  } else if (createHash('sha256').update(body).digest('hex') !== file.split('.')[0]) {
    problems.push(
      `plain request after a range request returned ${body.length} bytes that don't hash to the file's name`,
    );
  }
  const disposition = plain.headers.get('content-disposition') ?? '';
  if (track && /filename/i.test(disposition)) {
    problems.push(
      `served with Content-Disposition "${disposition}", whose filename overrides the track page's download name`,
    );
  }
  return problems;
}

const piecesDir = resolve(root, process.env.SPITE_PIECES_DIR ?? 'pieces');
const files = targets(piecesDir);
console.log(`probing ${files.length} file(s) under ${base}`);
for (const target of files) {
  let problems;
  try {
    problems = await probe(target);
  } catch (error) {
    problems = [`request failed (${error.message})`];
  }
  if (problems.length === 0) console.log(`ok  ${target.label}  ${target.file}`);
  for (const p of problems) {
    console.error(`${target.label}  ${target.file}  ${p}`);
    process.exitCode = 1;
  }
}
