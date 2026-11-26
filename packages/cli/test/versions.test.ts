import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatVersions,
  labelProblem,
  nextLabel,
  parseVersions,
  type VersionEntry,
} from '../src/versions.js';

const fixtures = join(import.meta.dirname, 'fixtures/versions');
const read = (kind: string, name: string) => readFileSync(join(fixtures, kind, name), 'utf8');
const list = (kind: string) => readdirSync(join(fixtures, kind)).sort();
const A = `sha256:${'a'.repeat(64)}`;
const B = `sha256:${'b'.repeat(64)}`;
const C = `sha256:${'c'.repeat(64)}`;

const problems = (text: string) => {
  const r = parseVersions(text);
  if (!('problems' in r)) throw new Error('expected problems');
  return r.problems.join('\n');
};
const entries = (text: string) => {
  const r = parseVersions(text);
  if (!('entries' in r)) throw new Error(r.problems.join('\n'));
  return r.entries;
};

describe('version list fixtures', () => {
  it.each(list('valid'))('accepts valid/%s', (name) => {
    expect(() => entries(read('valid', name))).not.toThrow();
  });
  it.each(list('invalid'))('rejects invalid/%s', (name) => {
    expect(parseVersions(read('invalid', name))).toHaveProperty('problems');
  });
});

describe('version list', () => {
  it('keeps entries oldest first, so the latest is last', () => {
    const e = entries(read('valid', 'three.json'));
    expect(e.map((v) => v.label)).toEqual(['v1', 'first-light', 'v2']);
    expect(e.at(-1)).toEqual({ hash: C, label: 'v2' });
  });

  it('an empty list has no versions', () => {
    expect(entries(read('valid', 'empty.json'))).toEqual([]);
  });

  it('formats with two-space indentation and a trailing newline, and round-trips', () => {
    const e: VersionEntry[] = [
      { hash: A, label: 'v1' },
      { hash: B, label: 'v2' },
    ];
    const text = formatVersions(e);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "versions": [\n    {\n      "hash"');
    expect(entries(text)).toEqual(e);
    expect(formatVersions(entries(read('valid', 'three.json')))).toBe(read('valid', 'three.json'));
  });
});

describe('version list validity', () => {
  it('names a repeated hash', () => {
    expect(problems(read('invalid', 'repeated-hash.json'))).toContain(`repeated hash ${A}`);
  });
  it('names a repeated label', () => {
    expect(problems(read('invalid', 'repeated-label.json'))).toContain('repeated label "v1"');
  });
  it('names an unknown entry field', () => {
    expect(problems(read('invalid', 'unknown-entry-field.json'))).toContain('"date"');
  });
  it('names an unknown top-level field', () => {
    expect(problems(read('invalid', 'unknown-top-field.json'))).toContain('"latest"');
  });
  it('rejects text that is not JSON', () => {
    expect(problems('{ "versions": [')).toContain('not valid JSON');
  });
  it('names a malformed hash', () => {
    expect(problems(read('invalid', 'malformed-hash.json'))).toContain('/versions/0/hash');
  });
});

describe('version labels', () => {
  it.each(['v1', 'first-light', 'take.2', 'a_b', '0', 'x'.repeat(32)])('accepts %s', (l) => {
    expect(labelProblem(l)).toBeNull();
  });
  it.each(['First', '-v1', '', 'x'.repeat(33), 'a b', 'v1/2'])('rejects %j', (l) => {
    expect(labelProblem(l)).toMatch(/not a valid label/);
  });
  it('reserves working', () => {
    expect(labelProblem('working')).toContain('reserved');
  });
  it('refuses 64 hex digits', () => {
    expect(labelProblem('b'.repeat(64))).toContain('hash');
  });
});

describe('nextLabel', () => {
  const of = (...labels: string[]) => labels.map((label, i) => ({ hash: `h${i}`, label }));
  it.each([
    [[], 'v1'],
    [['v1', 'v2'], 'v3'],
    [['v1', 'first-light', 'v2'], 'v3'],
    [['first-light'], 'v1'],
    [['v1', 'v10', 'v2'], 'v11'],
    [['v01'], 'v1'],
  ])('%j gives %s', (labels, expected) => {
    expect(nextLabel(of(...labels))).toBe(expected);
  });
});
