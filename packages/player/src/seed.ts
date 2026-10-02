const CONSONANTS = 'bcdfghjklmnprstvz';
const VOWELS = 'aeiou';

/**
 * A pronounceable random seed: four consonant-vowel syllables, e.g. "tamirobe". Platform
 * randomness only chooses *which* seed to play; a given seed always plays the same performance.
 */
export function randomSeed(): string {
  const values = crypto.getRandomValues(new Uint32Array(8));
  let seed = '';
  for (let i = 0; i < 4; i++) {
    seed +=
      CONSONANTS[values[2 * i]! % CONSONANTS.length]! + VOWELS[values[2 * i + 1]! % VOWELS.length]!;
  }
  return seed;
}
