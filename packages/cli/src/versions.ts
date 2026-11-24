/**
 * A piece's frozen versions, recorded in `pieces/<id>/versions.json` by `spite freeze`:
 * `{ "versions": [ { "hash": "sha256:<hex>", "label": "v1" }, ... ] }`, oldest first. The file is
 * only ever appended to; the last entry is the latest version.
 */

export interface VersionEntry {
  hash: string;
  label: string;
}

export const VERSIONS_FILE = 'versions.json';

const HASH = /^sha256:[0-9a-f]{64}$/;
const LABEL = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const AUTO_LABEL = /^v([1-9][0-9]*)$/;

/** Why `label` can't name a version, or null when it can. */
export function labelProblem(label: string): string | null {
  if (label === 'working') return '"working" is reserved for the working manifest';
  if (HEX64.test(label)) return `"${label}" looks like a hash; labels must not be 64 hex digits`;
  if (!LABEL.test(label)) {
    return `"${label}" is not a valid label (lowercase letters, digits, ".", "_" or "-", starting with a letter or digit, at most 32 characters)`;
  }
  return null;
}

const describe = (value: unknown) =>
  typeof value === 'string' ? `"${value}"` : JSON.stringify(value);

/** Parses a version list, returning its entries in order, or every problem found. */
export function parseVersions(text: string): { entries: VersionEntry[] } | { problems: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { problems: [`not valid JSON (${(error as Error).message})`] };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { problems: ['must be an object with a "versions" list'] };
  }
  const problems: string[] = [];
  for (const key of Object.keys(data)) {
    if (key !== 'versions') problems.push(`unknown field "${key}"`);
  }
  const list = (data as { versions?: unknown }).versions;
  if (!Array.isArray(list)) {
    problems.push('"versions" must be a list');
    return { problems };
  }
  const entries: VersionEntry[] = [];
  const hashes = new Set<string>();
  const labels = new Set<string>();
  list.forEach((item: unknown, i) => {
    const at = `/versions/${i}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      problems.push(`${at}  must be an object with "hash" and "label"`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (key !== 'hash' && key !== 'label') problems.push(`${at}  unknown field "${key}"`);
    }
    const { hash, label } = item as { hash?: unknown; label?: unknown };
    let ok = true;
    if (typeof hash !== 'string' || !HASH.test(hash)) {
      problems.push(`${at}/hash  ${describe(hash)} is not a sha256:<64 hex> hash`);
      ok = false;
    } else if (hashes.has(hash)) {
      problems.push(`${at}/hash  repeated hash ${hash}`);
      ok = false;
    }
    if (typeof label !== 'string') {
      problems.push(`${at}/label  ${describe(label)} is not a label`);
      ok = false;
    } else {
      const problem = labelProblem(label);
      if (problem) {
        problems.push(`${at}/label  ${problem}`);
        ok = false;
      } else if (labels.has(label)) {
        problems.push(`${at}/label  repeated label "${label}"`);
        ok = false;
      }
    }
    if (typeof hash === 'string') hashes.add(hash);
    if (typeof label === 'string') labels.add(label);
    if (ok) entries.push({ hash: hash as string, label: label as string });
  });
  return problems.length > 0 ? { problems } : { entries };
}

/** The next automatic label: `v<n>` for the smallest n above every existing `v<number>` label. */
export function nextLabel(entries: readonly VersionEntry[]): string {
  let max = 0;
  for (const { label } of entries) {
    const m = AUTO_LABEL.exec(label);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `v${max + 1}`;
}

/** The file's text: two-space indentation and a trailing newline, as Prettier leaves it. */
export function formatVersions(entries: readonly VersionEntry[]): string {
  const versions = entries.map(({ hash, label }) => ({ hash, label }));
  return JSON.stringify({ versions }, null, 2) + '\n';
}
