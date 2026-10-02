# Golden traces

Snapshots of `schema/examples/valid/minimal.json` realized for 64 bars with seeds `0`, `42` and
`"spite-store"`. Each file holds `{ manifest, seed, durationBars, traceFormat, traceHash, trace }`.

The test suite never writes these. Regenerate them on purpose with `pnpm golden:update`, and only
alongside a `traceFormat` bump or a change you intend to alter existing seeds.
