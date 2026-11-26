import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkRelease } from '../release.js';
import { parseVersionList } from '../src/url.js';

// The same examples the CLI's release tests run: both must sort them into valid and invalid alike.
const examples = join(import.meta.dirname, '../../schema/examples/release');
const list = (kind: string) => readdirSync(join(examples, kind)).sort();

function check(kind: string, name: string): string[] {
  const dir = join(examples, kind, name);
  const data: unknown = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
  let versions: string[] | null = null;
  try {
    const parsed = parseVersionList(readFileSync(join(dir, 'versions.json'), 'utf8'));
    if (typeof parsed === 'string') throw new Error(parsed);
    versions = parsed.map((v) => v.hex);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return checkRelease(data, versions);
}

describe('site release check agrees with the CLI on the examples', () => {
  it.each(list('valid'))('accepts valid/%s', (name) => {
    expect(check('valid', name)).toEqual([]);
  });
  it.each(list('invalid'))('rejects invalid/%s', (name) => {
    expect(check('invalid', name).length).toBeGreaterThan(0);
  });
  it('names a duplicate track id', () => {
    expect(check('invalid', 'duplicate-track-id').join('\n')).toContain('"first-light"');
  });
  it('names an unknown top-level field by pointer', () => {
    expect(check('invalid', 'unknown-field')).toEqual([
      '/price  must NOT have additional properties',
    ]);
  });
});
