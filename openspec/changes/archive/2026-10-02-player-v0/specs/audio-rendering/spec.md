## ADDED Requirements

### Requirement: Float32 output snapshots
A float32 rendering of a performance is the renderer's stereo samples with each sample rounded to the nearest float32 (as when written into a `Float32Array`). The repository SHALL hold float32 golden snapshots in `fixtures/golden/placeholder.float32.<seed>.json` for the placeholder piece rendered for 16 bars with seeds `0`, `42` and `"spite-store"`. Each snapshot SHALL record the seed, duration, frame count and the sha256 of the samples interleaved left/right as little-endian float32. The test suite SHALL recompute these in Node and fail on any difference until the snapshots are regenerated on purpose.

#### Scenario: Node matches the float32 snapshots
- **WHEN** the test suite runs
- **THEN** each of the three float32 renderings computed in Node hashes to the value in its snapshot

#### Scenario: Float32 rounding is applied per sample
- **WHEN** a renderer sample is `0.1` (not representable in float32)
- **THEN** the float32 rendering holds `Math.fround(0.1)` at that position
