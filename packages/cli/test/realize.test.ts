import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root, sha256, spite } from './helpers.js';

const minimal = 'schema/examples/valid/minimal.json';

describe('spite realize', () => {
  it('prints a readable trace naming clips by id', async () => {
    const r = await spite('realize', minimal, '--seed', '42', '--bars', '16');
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines[0]).toMatch(/^minimal {2}seed "42" {2}16 bars {2}\d+ events$/);
    expect(lines[1]).toMatch(/^ {3}0 {2}> intro/);
    expect(r.stdout).toMatch(/drums=kick-[ab]/);
    expect(r.stdout).not.toContain('sha256:');
    for (const line of lines.slice(1)) expect(Number(line.slice(0, 4))).toBeLessThan(16);
  });

  it('prints the canonical trace with --json, matching the golden hash', async () => {
    const r = await spite('realize', minimal, '--seed', '42', '--bars', '64', '--json');
    expect(r.code).toBe(0);
    const golden = JSON.parse(readFileSync(join(root, 'fixtures/golden/minimal.42.json'), 'utf8'));
    expect(sha256(r.stdout.replace(/\n$/, ''))).toBe(golden.traceHash);
  });

  it('reports where a piece ends early', async () => {
    const r = await spite('realize', minimal, '--seed', '0', '--bars', '200');
    expect(r.stdout.split('\n')[0]).toMatch(/ended at bar \d+$/);
  });

  it('rejects bad usage and invalid manifests', async () => {
    expect((await spite('realize', minimal)).code).toBe(2);
    expect((await spite('realize', minimal, '--seed', '1', '--bars', '0')).code).toBe(2);
    expect((await spite('realize', minimal, '--seed', '1', '--frobnicate')).code).toBe(2);
    expect((await spite('realize', '--seed', '1')).code).toBe(2);
    const invalid = await spite(
      'realize',
      'schema/examples/invalid/dangling-transition.json',
      '--seed',
      '1',
    );
    expect(invalid.code).toBe(1);
    expect(invalid.stdout).toContain('/sections/2/next/1/to');
  });
});
