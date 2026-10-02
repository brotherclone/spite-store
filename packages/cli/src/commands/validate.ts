import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, USAGE, loadManifest } from '../common.js';

export function validateCommand(files: string[]): number {
  if (files.length === 0) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  let exit = EXIT_OK;
  for (const file of files) {
    const result = loadManifest(file);
    if ('manifest' in result) {
      console.log(`${file}  valid`);
    } else if (result.exit === EXIT_USAGE) {
      exit = EXIT_USAGE;
    } else if (exit === EXIT_OK) {
      exit = EXIT_INVALID;
    }
  }
  return exit;
}
