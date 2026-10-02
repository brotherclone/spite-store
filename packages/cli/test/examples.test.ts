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

describe('plain-language messages', () => {
  const messagesFor = (file: string) =>
    validateManifest(read('invalid', file)).map((e) => e.message);

  it('never shows a raw regular expression or bare schema keyword', () => {
    for (const file of list('invalid')) {
      for (const message of messagesFor(file)) {
        expect(message).not.toMatch(
          /\^|\$"|\[0-9a-f\]|\{0,63\}|must match pattern|must be equal to constant/,
        );
      }
    }
  });

  it('names the bad hash and describes a valid one', () => {
    const [message] = messagesFor('malformed-hash.json');
    expect(message).toContain('"sha256:ABC"');
    expect(message).toContain('"sha256:" followed by 64 lowercase hex characters');
    expect(messagesFor('hash-is-file-path.json')[0]).toContain('"stems/kick.wav"');
  });

  it('names the bad id and the allowed characters', () => {
    const [message] = messagesFor('invalid-identifier.json');
    expect(message).toContain('"Drums Loop"');
    expect(message).toMatch(/lowercase letters, digits, "-" or "_"/);
  });

  it('names the unsupported and supported specVersion', () => {
    const [message] = messagesFor('unknown-spec-version.json');
    expect(message).toContain('"9.9"');
    expect(message).toContain('"0.1"');
  });

  it('points at an invalid clip key and names it', () => {
    const base = read('valid', 'minimal.json') as { clips: Record<string, unknown> };
    const errors = validateManifest({
      ...base,
      clips: { ...base.clips, 'Bad Key': base.clips['kick-a'] },
    });
    expect(errors).toEqual([
      { pointer: '/clips/Bad Key', message: expect.stringMatching(/^"Bad Key" is not a valid id/) },
    ]);
  });

  it('describes other structural errors plainly', () => {
    const base = read('valid', 'minimal.json') as Record<string, unknown>;
    const messages = validateManifest({ ...base, title: undefined, extra: 1, tempo: [] }).map(
      (e) => e.message,
    );
    expect(messages).toContain('missing required property "title"');
    expect(messages).toContain('unknown property "extra"');
    expect(messages).toContain('expected at least 1 item(s), got 0');
  });
});
