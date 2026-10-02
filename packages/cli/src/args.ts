import { parseArgs, type ParseArgsConfig } from 'node:util';
import { UsageError } from './common.js';

type Options = NonNullable<ParseArgsConfig['options']>;

/** Strict flag parsing (unknown flags are usage errors), built on node:util parseArgs. */
export function parse<O extends Options>(argv: string[], options: O) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}
