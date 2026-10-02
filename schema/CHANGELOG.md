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
