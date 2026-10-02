import { createRequire } from 'node:module';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { checkManifest, type ManifestError } from '@spite-store/engine';

const require = createRequire(import.meta.url);
const schema: object = require('@spite-store/schema/manifest.schema.json');

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

function describe(error: ErrorObject): string {
  const p = error.params as Record<string, unknown>;
  if (error.keyword === 'additionalProperties')
    return `unknown property "${String(p.additionalProperty)}"`;
  if (error.keyword === 'const') return `${error.message} ${JSON.stringify(p.allowedValue)}`;
  if (error.keyword === 'enum') return `${error.message}: ${JSON.stringify(p.allowedValues)}`;
  if (error.keyword === 'propertyName') return `invalid key "${String(p.propertyName)}"`;
  return error.message ?? error.keyword;
}

/**
 * Validates a parsed manifest: first against the JSON Schema, then (if the structure is sound)
 * against the engine's semantic rules. Both kinds of error are `{ pointer, message }`.
 */
export function validateManifest(data: unknown): ManifestError[] {
  if (!validateSchema(data)) {
    return (validateSchema.errors ?? []).map((e) => ({
      pointer:
        e.keyword === 'propertyName'
          ? `${e.instancePath}/${String((e.params as { propertyName: string }).propertyName)}`
          : e.instancePath,
      message: describe(e),
    }));
  }
  return checkManifest(data);
}
