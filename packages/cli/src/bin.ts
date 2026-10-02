#!/usr/bin/env node
import { EXIT_OK, EXIT_USAGE, USAGE, UsageError } from './common.js';
import { auditionCommand } from './commands/audition.js';
import { bounceCommand } from './commands/bounce.js';
import { realizeCommand } from './commands/realize.js';
import { validateCommand } from './commands/validate.js';

function main(argv: string[]): number | Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'validate':
      return validateCommand(rest);
    case 'realize':
      return realizeCommand(rest);
    case 'bounce':
      return bounceCommand(rest);
    case 'audition':
      return auditionCommand(rest);
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

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(`spite: ${error.message}\n\n${USAGE}`);
  process.exitCode = EXIT_USAGE;
}
