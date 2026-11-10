import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Manifest } from '@spite-store/engine';
import { sha256 } from './common.js';

/** One file a set of manifests references: a stem or a fallback recording. */
export interface PublishFile {
  /** The stored name, `<hex>.wav` or `<hex>.mp3`. */
  name: string;
  hash: string;
  /** Clip ids using it, plus `fallback` for a fallback recording. */
  owners: string[];
  contentType: 'audio/wav' | 'audio/mpeg';
}

const EXTENSIONS = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3' } as const;

/** Every catalogued clip and fallback across the manifests, one entry per file, sorted by name. */
export function collectFiles(manifests: readonly Manifest[]): PublishFile[] {
  const files = new Map<string, PublishFile>();
  const add = (hash: string, owner: string, contentType: PublishFile['contentType']) => {
    const name = `${hash.slice('sha256:'.length)}.${EXTENSIONS[contentType]}`;
    const file = files.get(name) ?? { name, hash, owners: [], contentType };
    if (!file.owners.includes(owner)) file.owners.push(owner);
    files.set(name, file);
  };
  for (const manifest of manifests) {
    for (const id of Object.keys(manifest.clips).sort()) {
      add(manifest.clips[id]!.hash, id, 'audio/wav');
    }
    if (manifest.fallback) add(manifest.fallback.hash, 'fallback', manifest.fallback.type);
  }
  for (const file of files.values()) file.owners.sort();
  return [...files.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface FileProblem {
  file: PublishFile;
  reason: string;
}

/** Reads every file from `dir` and checks its hash. Returns the bytes, or every problem found. */
export function readLocalFiles(
  files: readonly PublishFile[],
  dir: string,
): { bytes: Map<string, Uint8Array>; problems: FileProblem[] } {
  const bytes = new Map<string, Uint8Array>();
  const problems: FileProblem[] = [];
  for (const file of files) {
    const path = join(dir, file.name);
    let data: Buffer;
    try {
      data = readFileSync(path);
    } catch {
      problems.push({ file, reason: `missing (${path})` });
      continue;
    }
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (sha256(view) !== file.hash) {
      problems.push({ file, reason: `content of ${path} does not match its hash` });
      continue;
    }
    bytes.set(file.name, view);
  }
  return { bytes, problems };
}

/** The public store, by file name. Files are never replaced or deleted. */
export interface StemStore {
  has(name: string): Promise<boolean>;
  put(name: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export const STORE_PREFIX = 'stems/';
export const STORE_MAX_AGE = 31_536_000;

/** The Vercel Blob store. `@vercel/blob` is loaded only here, so no other command needs it. */
export async function blobStore(token: string): Promise<StemStore> {
  const { BlobNotFoundError, head, put } = await import('@vercel/blob');
  return {
    async has(name) {
      try {
        await head(STORE_PREFIX + name, { token });
        return true;
      } catch (error) {
        if (error instanceof BlobNotFoundError) return false;
        throw error;
      }
    },
    async put(name, bytes, contentType) {
      await put(STORE_PREFIX + name, Buffer.from(bytes), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: STORE_MAX_AGE,
        contentType,
        token,
      });
    },
  };
}

/** Runs `task` over `items` with at most `limit` in flight, keeping results in order. */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export type UploadResult = { file: PublishFile } & (
  { status: 'uploaded' | 'present' } | { status: 'failed'; reason: string }
);

/** Uploads every file the store lacks, four at a time. */
export function uploadMissing(
  files: readonly PublishFile[],
  bytes: ReadonlyMap<string, Uint8Array>,
  store: StemStore,
): Promise<UploadResult[]> {
  return pool(files, 4, async (file): Promise<UploadResult> => {
    try {
      if (await store.has(file.name)) return { file, status: 'present' };
      await store.put(file.name, bytes.get(file.name)!, file.contentType);
      return { file, status: 'uploaded' };
    } catch (error) {
      return { file, status: 'failed', reason: (error as Error).message };
    }
  });
}

/** Sends `HEAD <base><name>` for every file, eight at a time, retrying each failure once. */
export function checkReachable(
  files: readonly PublishFile[],
  base: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ file: PublishFile; reachable: boolean; reason: string }[]> {
  const attempt = async (url: string): Promise<string | null> => {
    try {
      const response = await fetchImpl(url, { method: 'HEAD' });
      return response.ok ? null : `HTTP ${response.status}`;
    } catch (error) {
      return (error as Error).message;
    }
  };
  return pool(files, 8, async (file) => {
    const url = base + file.name;
    const reason = (await attempt(url)) === null ? null : await attempt(url);
    return { file, reachable: reason === null, reason: reason ?? 'ok' };
  });
}
