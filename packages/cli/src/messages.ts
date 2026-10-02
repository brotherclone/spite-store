import type { ErrorObject } from 'ajv/dist/2020.js';

/** Reads the value at a JSON Pointer, or undefined. */
function at(data: unknown, pointer: string): unknown {
  let value = data;
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

const show = (value: unknown): string => (value === undefined ? 'nothing' : JSON.stringify(value));

/** Turns an Ajv error into a plain-language message that names the offending value. */
export function describeSchemaError(error: ErrorObject, data: unknown): string {
  const p = error.params as Record<string, unknown>;
  // Errors inside `propertyNames` are about the key itself, not the object at instancePath.
  const value =
    error.propertyName !== undefined ? error.propertyName : at(data, error.instancePath);
  switch (error.keyword) {
    case 'pattern':
      if (error.schemaPath.includes('/$defs/id/')) {
        return `${show(value)} is not a valid id: use 1-64 lowercase letters, digits, "-" or "_", starting with a letter or digit`;
      }
      if (error.instancePath.endsWith('/hash')) {
        return `${show(value)} is not a valid hash: expected "sha256:" followed by 64 lowercase hex characters`;
      }
      return `${show(value)} does not have the expected format`;
    case 'const':
      if (error.instancePath === '/specVersion') {
        return `unsupported specVersion ${show(value)}: this tool supports ${show(p.allowedValue)}`;
      }
      return `expected ${show(p.allowedValue)}, got ${show(value)}`;
    case 'required':
      return `missing required property "${String(p.missingProperty)}"`;
    case 'additionalProperties':
      return `unknown property "${String(p.additionalProperty)}"`;
    case 'propertyNames':
      return `invalid key "${String(p.propertyName)}"`;
    case 'type':
      return `expected ${String(p.type)}, got ${show(value)}`;
    case 'enum':
      return `expected one of ${(p.allowedValues as unknown[]).map(show).join(', ')}, got ${show(value)}`;
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum': {
      const words = {
        minimum: 'at least',
        maximum: 'at most',
        exclusiveMinimum: 'greater than',
        exclusiveMaximum: 'less than',
      };
      return `expected a number ${words[error.keyword]} ${String(p.limit)}, got ${show(value)}`;
    }
    case 'minItems':
      return `expected at least ${String(p.limit)} item(s), got ${Array.isArray(value) ? value.length : show(value)}`;
    case 'maxItems':
      return `expected at most ${String(p.limit)} item(s), got ${Array.isArray(value) ? value.length : show(value)}`;
    case 'minProperties':
      return `expected at least ${String(p.limit)} entr${p.limit === 1 ? 'y' : 'ies'}`;
    case 'minLength':
      return `expected a non-empty string, got ${show(value)}`;
    case 'uniqueItems':
      return `items must be unique, but ${show(value)} has duplicates`;
    default:
      return `invalid value ${show(value)}: ${error.message ?? error.keyword}`;
  }
}
