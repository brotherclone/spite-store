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
