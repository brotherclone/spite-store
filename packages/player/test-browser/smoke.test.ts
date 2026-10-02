import { expect, it } from 'vitest';

it('runs with Web Audio and an AudioWorklet available', () => {
  expect(typeof OfflineAudioContext).toBe('function');
  expect(typeof AudioWorkletNode).toBe('function');
  expect(typeof crypto.subtle.digest).toBe('function');
});
