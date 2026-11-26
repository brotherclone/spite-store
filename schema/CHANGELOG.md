# Manifest schema changelog

Every change to `manifest.schema.json` is recorded here. A change that alters how an existing
manifest validates or realizes bumps `specVersion`.

## 0.1

Initial draft.

- `specVersion` (const `"0.1"`), `id`, `title`.
- Tempo map: `{ bar, bpm, meter: [beats, unit] }` entries, starting at bar 0 with strictly
  increasing bars.
- Clip catalogue keyed by id: `hash` (`sha256:` + 64 lowercase hex), `lengthBars`, optional `gain`
  and symmetric `excludes`.
- Sections with `lengthBars`, optional `maxVisits`, slots and weighted `next` transitions; a
  `start` section.
- Slots with `enter` probability, `gain`, `noRepeat` window and a weighted clip `pool`.
- Optional form `envelope`: `{ at, value }` breakpoints from `at: 0` to `at: 1`.
- Ids match `^[a-z0-9][a-z0-9_-]{0,63}$`.

### 0.1 addition: `fallback`

- Optional top-level `fallback`: `{ hash, type, seed, bars }`, one fixed recording of the piece
  (`type` is `"audio/mpeg"`, the only allowed value), rendered from `seed` for `bars` bars. Players
  use it when they can't play the piece generatively. Realization and rendering ignore it.
- `specVersion` stays `0.1`: every existing manifest validates and realizes exactly as before. A
  manifest that uses `fallback` does not validate with a validator from before this addition.

### 0.1 addition: `engine`

- Optional top-level `engine`: `{ trace, render }`, both integers of at least 1, the engine's
  `TRACE_FORMAT` and `RENDER_FORMAT` that the piece was released with. Players and the CLI refuse to
  realize a pinned manifest on other formats (players play its `fallback` instead). Validation
  doesn't compare the pin with any engine, and realization and rendering ignore it.
- `specVersion` stays `0.1`: every existing manifest validates and realizes exactly as before. A
  manifest that uses `engine` does not validate with a validator from before this addition.

### 0.1 note: stems are FLAC

- A clip's `hash` is still the sha256 of its stem file, but stem files are now FLAC (48 kHz, mono
  or stereo, 16- or 24-bit), written by the engine's canonical encoder. They used to be WAV.
- No schema change: every manifest validates exactly as before, and a seed renders the same samples
  from the FLAC stems as from the WAV ones. Re-packed pieces get new clip hashes.

### 0.1 addition: `pan`

- Optional slot `pan`: the slot's stereo position, either a number in [-1, 1] (−1 hard left, 0
  centre, 1 hard right) or a range `{ min, max }` within [-1, 1], from which each pick draws a
  position. `min` must not exceed `max`; the engine checks this, since the JSON Schema can't.
- A slot without `pan` is centred, exactly as before.
- `specVersion` stays `0.1`: every existing manifest validates, realizes and renders exactly as
  before. A manifest that uses `pan` does not validate with a validator from before this addition.
- The engine's own check now also rejects unknown slot properties, as the JSON Schema always has.

## Release file

`release.schema.json` describes `pieces/<id>/release.json`, a piece's release metadata kept outside
the manifest so it can change without making a new version. It is separate from the manifest
schema and doesn't affect how any manifest validates or realizes.

- Optional `credits`: `{ name, role }` entries, both non-empty strings, in display order.
- Optional `tracks`: `{ id, title, version, seed, bars, audio, frames }`, a named, fixed
  performance of a frozen version. `version` and `audio` are `sha256:` hashes (the frozen manifest
  and the track's 24-bit FLAC); `bars` and `frames` are positive integers.
- Rules outside the schema, checked by the CLI and the site build: track ids are unique within the
  piece, and every track's `version` is recorded in the piece's `versions.json`.
- Examples are in `examples/release/{valid,invalid}/`, each a `release.json` with, where it has
  tracks, a fixture `versions.json` beside it.
