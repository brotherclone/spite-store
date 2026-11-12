# @spite-store/cli

The `spite` command: validate manifests, print a seed's trace, render a seed to WAV, audition
several seeds back to back, and pack recordings into stems.

## Running it

Build first, then run it through pnpm from anywhere in the workspace:

```sh
pnpm build
pnpm exec spite validate schema/examples/valid/minimal.json          # from the repo root
pnpm --filter @spite-store/cli exec spite validate ../../schema/examples/valid/minimal.json
```

`--filter … exec` runs inside `packages/cli`, so paths are relative to that directory.

## `spite validate <manifest.json...>`

Each file is checked in two layers:

1. **JSON Schema** (`@spite-store/schema`, Ajv draft 2020-12, all errors): structure, types,
   ranges, id and hash patterns, `specVersion`.
2. **Semantic rules** (`checkManifest()` from `@spite-store/engine`): unknown `start`, `to`, pool
   and `excludes` references, duplicate section or slot ids, tempo map starting at bar 0 with
   strictly increasing bars, all-zero pool weights, and envelope endpoints and ordering. This layer
   runs only when the schema passes, so it never reports on malformed structure.

Output, one line per file or per error:

```
schema/examples/valid/minimal.json  valid
schema/examples/invalid/dangling-transition.json  /sections/2/next/1/to  section "bridge" transitions to unknown section "coda"
```

The middle column is a JSON Pointer into the manifest (`(root)` for the document itself).
Unreadable or unparseable files are reported on stderr as `file  error: reason`.

| Exit code | Meaning                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| 0         | Success (for `validate`: every file is valid)                                                              |
| 1         | A manifest is invalid                                                                                      |
| 2         | Usage error (bad flags, unknown or stub command), a file missing or not JSON, or a missing or invalid stem |

## Stems

Commands that render audio look up each clip's stem by content hash: `sha256:<hex>` is read from
`<dir>/<hex>.wav`, where `<dir>` is `--stems` (default `.stems/` in the current directory). The file
must hash to that value and be a 48 kHz mono or stereo WAV (16/24-bit PCM or float32). Only stems
the render actually uses are needed; every missing or invalid one is listed and the command exits 2.

For the placeholder piece, `pnpm stems:placeholder` synthesizes the stems into `.stems/`. For a
recorded piece, `spite pack` cuts them from the recordings (below).

## Engine pin

A released manifest records the engine formats it was made with: `"engine": { "trace": 1, "render": 1 }`,
the engine's `TRACE_FORMAT` and `RENDER_FORMAT`. A seed link means "this manifest, played by this
engine", so `realize`, `bounce` and `audition` refuse a manifest pinned to other formats: they
print each differing format with its pinned and current number and exit 1, before reading any stem.
`--ignore-pin` plays the current engine's version anyway, after a warning. It is for an author
hearing what a format change did, before deciding whether to re-pin. `spite fallback` has no such
flag, because a fallback must be a recording of the pinned performance. An unpinned manifest plays
on whatever engine runs it. `spite pin` (below) writes the pin, and the deploy check refuses to
deploy an unpinned piece.

## `spite realize <manifest> --seed <seed> [--bars 64] [--json]`

Prints the trace. The readable form names clips by id and marks each new section visit:

```
minimal  seed "42"  16 bars  17 events
   0  > intro  drums=kick-a  pad=pad-a
   1           drums=kick-b
   4  > verse  bass=bass-b  drums=kick-a
```

`--json` prints the canonical trace JSON (its sha256 is the golden `traceHash`). Seeds on the command
line are strings; `--seed 42` is the same seed as the number `42`.

## `spite bounce <manifest> --seed <seed> -o <out.wav> [--bars 64] [--stems <dir>]`

Renders one seed to a 16-bit 48 kHz stereo WAV, including the tails that ring out after the last bar.

```sh
pnpm exec spite bounce pieces/placeholder/manifest.json --seed 42 --bars 16 -o out.wav
```

## `spite audition <manifest> [--seeds 4 | --seed <s>...] [--bars 16] [--stems <dir>] [--out <file>] [--no-play]`

Renders several seeds into one reel with 2 seconds of silence between them, prints where each seed
starts and its section sequence, then plays the reel with `afplay` (macOS). Without `--seed` it uses
seeds `0` to `k - 1`. Repeat `--seed` to choose seeds yourself. The reel goes to `--out`, or to a
temporary file named by its content. `--no-play` (or a non-macOS system) only writes it.

```sh
pnpm exec spite audition pieces/placeholder/manifest.json
pnpm exec spite audition pieces/placeholder/manifest.json --seed spite --seed 7 --bars 32 --no-play --out reel.wav
```

## `spite pack <manifest> --source <dir> [--stems <dir>] [--update]`

Cuts a recorded piece's clips out of its source recordings and writes them to the stems directory
(default `.stems/`) by content hash. What to cut lives in `pack.json` beside the manifest:

```json
{
  "sources": {
    "cello-close": { "file": "Maria/Cello close.wav", "sha256": "sha256:…" }
  },
  "clips": {
    "cello-close-1": { "source": "cello-close", "startBar": 0, "bars": 5 }
  }
}
```

- `file` is relative to `--source`, so no machine's paths are committed. `sha256` is the source
  file's hash, which catches a re-export or a swapped file.
- A clip's stem is the source's frames from the start of `startBar` up to the start of
  `startBar + bars`, using the manifest's tempo map exactly as the renderer places bars. `bars` must
  be at least the clip's `lengthBars`. Anything after the body is the clip's tail.
- Every manifest clip needs exactly one entry, and every entry must name a manifest clip.
- Sources must be 48 kHz mono or stereo WAV (16/24-bit PCM or float32). Nothing is resampled or
  converted. The stem keeps the source's sample bytes unchanged in a minimal WAV (just `fmt ` and
  `data`), so DAW metadata never affects the hash.

Pack then compares each clip's stem hash with the manifest. With `--update` it rewrites the
manifest's clip hashes and the pack file's source hashes instead (formatted with Prettier when it is
available), touching a file only if a hash in it changed.

| Exit code | Meaning                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| 0         | Stems written, and every hash matches (or was updated with `--update`)          |
| 1         | Invalid manifest, a clip hash differs, or a source changed (without `--update`) |
| 2         | Usage error, or a missing, unreadable or unsupported source or pack file        |

```sh
pnpm exec spite pack pieces/the-river-forgets-to-answer/manifest.json --source "<…>/Collaborations"
```

## `spite fallback <manifest> --seed <seed> [--bars 64] [--stems <dir>] [--update]`

Makes a piece's fallback recording: one fixed performance that `<spite-player>` plays when a
browser can't run the generative version. It renders the seed exactly as `spite bounce` does,
encodes it to MP3 (48 kHz stereo, 256 kbps CBR) and writes `<dir>/<hex>.mp3`, named by the MP3's
own sha256. It prints the hash, duration and size.

It then compares the result with the manifest's `fallback`. With `--update` it records
`{ hash, type: "audio/mpeg", seed, bars }` there (formatted with Prettier when available), and
leaves every other field alone. Without `--update`, a different hash, seed or length is reported
and the manifest is left unchanged.

Encoding needs `ffmpeg` with `libmp3lame` on `PATH` (`brew install ffmpeg`). No other command needs
it. Metadata and the encoder-version tag are stripped, so one ffmpeg build always gives the same
bytes, but another ffmpeg or LAME version may not. That's why the manifest pins the published
file by hash. Re-encoding on a different machine reports a changed hash (exit 1) rather than
silently replacing a published recording. Only the render is part of the determinism promise.

| Exit code | Meaning                                                                 |
| --------- | ----------------------------------------------------------------------- |
| 0         | File written, and the manifest's fallback matches (or was updated)      |
| 1         | Invalid manifest, a mismatched pin, or the fallback differs             |
| 2         | Usage error, a missing or invalid stem, or no `ffmpeg` with MP3 support |

```sh
pnpm exec spite fallback pieces/the-river-forgets-to-answer/manifest.json --seed spite-store --update
```

## `spite publish <manifest...> [--stems <dir>]`

Uploads every file the manifests reference to the public stem store (Vercel Blob): the stem of
every clip in each catalogue, not only those a seed happens to use, and each manifest's fallback.
Files are stored at `stems/<hex>.wav` (or `stems/<hex>.mp3`), named by content hash, publicly
readable, with no random suffix and a one-year cache lifetime.

- Every file is read from the stems directory and checked against its hash **before** anything is
  uploaded. One missing or corrupt file means nothing is uploaded.
- A file the store already holds is skipped. A stored file is never replaced or deleted, so a
  second run uploads nothing, and every earlier deployment keeps finding its stems.
- The store's write token comes from `BLOB_READ_WRITE_TOKEN` and is never printed. `vercel env pull
.env.local` writes it to a git-ignored file. Then:

```sh
node --env-file=.env.local packages/cli/bin/spite.js publish pieces/*/manifest.json
```

## `spite publish --check <base-url> <manifest...>`

Uploads nothing and needs no token: sends `HEAD <base-url><hex>.<ext>` for every referenced file
(one retry each) and lists each one that doesn't answer 2xx. The Vercel build runs this through
`scripts/deploy-check.mjs`, so a deployment can't go live with a missing stem.

| Exit code | Meaning                                                                     |
| --------- | --------------------------------------------------------------------------- |
| 0         | Every file uploaded or already present (`--check`: every file reachable)    |
| 1         | Invalid manifest, a failed upload, or (`--check`) an unreachable file       |
| 2         | Usage error, a missing or corrupt local file, or no `BLOB_READ_WRITE_TOKEN` |

## `spite pin <manifest> [--update]`

Reports the manifest's engine pin against this engine: pinned to the current formats, not pinned,
or pinned to other formats (each differing number, and whether the piece was made with an older or
a newer engine). Without `--update` it never changes the file.

With `--update` it sets `engine` to this engine's formats, directly after `specVersion`, and
leaves every other field alone. A manifest already pinned to the current formats isn't rewritten.
Replacing a different pin is a re-release: every existing seed link to the piece will play a
different performance from the one it was shared as, and the command warns about that. Do it only
on purpose. A stranded piece otherwise keeps playing its fallback recording on the site.

| Exit code | Meaning                                                 |
| --------- | ------------------------------------------------------- |
| 0         | Pinned to the current formats (or pinned by `--update`) |
| 1         | Invalid manifest, unpinned, or pinned to other formats  |
| 2         | Usage error or unreadable file                          |

```sh
pnpm exec spite pin pieces/the-river-forgets-to-answer/manifest.json
```
