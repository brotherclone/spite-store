import { createRequire } from 'node:module';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { checkManifest, type ManifestError } from '@spite-store/engine';
import { describeSchemaError } from './messages.js';

const require = createRequire(import.meta.url);
const schema: object = require('@spite-store/schema/manifest.schema.json');

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

/**
 * Validates a parsed manifest: first against the JSON Schema, then (if the structure is sound)
 * against the engine's semantic rules. Both kinds of error are `{ pointer, message }`.
 */
export function validateManifest(data: unknown): ManifestError[] {
  if (!validateSchema(data)) {
    return (validateSchema.errors ?? [])
      .filter((e) => e.keyword !== 'propertyNames') // the inner error already names the key
      .map((e) => ({
        pointer:
          e.propertyName !== undefined
            ? `${e.instancePath}/${e.propertyName.replace(/~/g, '~0').replace(/\//g, '~1')}`
            : e.instancePath,
        message: describeSchemaError(e, data),
      }));
  }
  return checkManifest(data);
}
