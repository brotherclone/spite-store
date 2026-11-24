import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Manifest, Slot } from '../../src/index.js';

const overlay = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/placeholder-panned.json'), 'utf8'),
) as Record<string, Slot['pan'] | string>;

/** The placeholder with the fixture's pans applied, by section/slot id. */
export function panned(placeholder: Manifest): Manifest {
  const copy = structuredClone(placeholder);
  for (const section of copy.sections) {
    for (const slot of section.slots ?? []) {
      const pan = overlay[`${section.id}/${slot.id}`];
      if (pan !== undefined && typeof pan !== 'string') slot.pan = pan;
    }
  }
  return copy;
}
