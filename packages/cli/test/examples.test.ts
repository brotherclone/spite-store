import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../src/validate.js';

const examples = join(import.meta.dirname, '../../../schema/examples');
const read = (dir: string, file: string): unknown =>
  JSON.parse(readFileSync(join(examples, dir, file), 'utf8'));
const list = (dir: string) => readdirSync(join(examples, dir)).filter((f) => f.endsWith('.json'));

describe('manifest schema', () => {
  it('compiles with Ajv2020 in strict mode', () => {
    const schema: object = createRequire(import.meta.url)(
      '@spite-store/schema/manifest.schema.json',
    );
    expect(() => new Ajv2020({ strict: true, allErrors: true }).compile(schema)).not.toThrow();
  });
});

describe('examples agree with the validator', () => {
  it('has a minimal valid example', () => {
    expect(list('valid')).toContain('minimal.json');
  });

  it.each(list('valid'))('valid/%s passes', (file) => {
    expect(validateManifest(read('valid', file))).toEqual([]);
  });

  it.each(list('invalid'))('invalid/%s fails at its stated pointer', (file) => {
    const manifest = read('invalid', file) as { $comment?: string };
    const expected = /Expected pointer: (\S*)/.exec(manifest.$comment ?? '')?.[1];
    expect(expected, 'invalid example must state its expected pointer').toBeDefined();
    const errors = validateManifest(manifest);
    expect(errors.map((e) => e.pointer)).toContain(expected);
  });
});
