import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const root = join(import.meta.dirname, '../../..');
const bin = join(root, 'packages/cli/bin/spite.js');

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the built `spite` binary from the repo root. */
export function spite(...args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [bin, ...args],
      { cwd: root, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr });
      },
    );
  });
}

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'spite-'));
export const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
