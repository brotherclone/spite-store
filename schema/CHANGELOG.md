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
