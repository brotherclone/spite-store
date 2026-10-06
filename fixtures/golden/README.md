# Golden traces

Snapshots of `schema/examples/valid/minimal.json` (`minimal.*.json`) and
`pieces/the-river-forgets-to-answer/manifest.json` (`the-river-forgets-to-answer.*.json`), each
realized for 64 bars with seeds `0`, `42` and `"spite-store"`. Each file holds
`{ manifest, seed, durationBars, traceFormat, traceHash, trace }`. Traces need no stems, so these
are checked in CI even though the river piece's audio is not in the repo.

The test suite never writes these. Regenerate them on purpose with `pnpm golden:update`, and only
alongside a `traceFormat` bump or a change you intend to alter existing seeds, such as retuning a
piece's manifest.
