#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validateManifest } from './validate.js';

const USAGE = `Usage: spite <command> [args]

Commands:
  validate <manifest.json...>   Check manifests against the schema and semantic rules
  audition                      (not implemented yet)
  bounce                        (not implemented yet)
  pack                          (not implemented yet)

Exit codes: 0 valid, 1 invalid manifest, 2 usage error or unreadable file.`;

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_USAGE = 2;

function validate(files: string[]): number {
  if (files.length === 0) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  let exit = EXIT_OK;
  for (const file of files) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      const reason =
        error instanceof SyntaxError
          ? `not valid JSON (${error.message})`
          : (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'no such file'
            : String(error);
      console.error(`${file}  error: ${reason}`);
      exit = EXIT_USAGE;
      continue;
    }
    const errors = validateManifest(data);
    if (errors.length === 0) {
      console.log(`${file}  valid`);
      continue;
    }
    for (const e of errors) console.log(`${file}  ${e.pointer || '(root)'}  ${e.message}`);
    if (exit === EXIT_OK) exit = EXIT_INVALID;
  }
  return exit;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  switch (command) {
    case 'validate':
      return validate(rest);
    case 'audition':
    case 'bounce':
    case 'pack':
      console.error(`spite ${command}: not implemented yet`);
      return EXIT_USAGE;
    case '-h':
    case '--help':
    case 'help':
      console.log(USAGE);
      return EXIT_OK;
    default:
      console.error(
        command === undefined ? USAGE : `spite: unknown command "${command}"\n\n${USAGE}`,
      );
      return EXIT_USAGE;
  }
}

process.exitCode = main(process.argv.slice(2));
