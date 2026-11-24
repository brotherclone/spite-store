# Spec Delta

## ADDED Requirements

### Requirement: Stereo placement
Each of the piece's eight slots SHALL have a fixed `pan` in standard quartet seating as seen from the audience: both violins left of centre, viola and cello right of centre, each instrument's close and room slots on the same side, and no slot beyond ±0.8. The values SHALL be chosen by the author by auditioning and recorded in the README. Placement SHALL change no clip choice: the engine pin stays trace 1 and render 1.

#### Scenario: Seating
- **WHEN** the manifest is inspected
- **THEN** every slot has a numeric `pan` with `|pan| ≤ 0.8`, the `vio1-*` and `vio2-*` slots are negative, the `viola-*` and `cello-*` slots are positive, and the engine pin is `{ "trace": 1, "render": 1 }`

#### Scenario: Same clip choices as the centred release
- **WHEN** the placed piece is realized for 64 bars with seeds `0`, `42` and `"spite-store"`
- **THEN** removing the `pan` fields from each trace yields exactly the centred release's trace for that seed, and every event's `pan` is its slot's value

#### Scenario: Golden traces carry the placement
- **WHEN** the River's golden trace snapshots are inspected after the re-release
- **THEN** every event has a `pan` field, and the test suite passes without any stems

### Requirement: Placed fallback
The piece's fallback SHALL be re-rendered from the placed manifest, still seed `spite-store` for 64 bars, and published before the placed manifest is deployed, so the fallback sounds like the performance the player would play.

#### Scenario: New fallback declared and published
- **WHEN** the manifest is inspected after the re-release and `spite publish --check` is run against the store
- **THEN** the `fallback` hash differs from the centred release's, its seed is `spite-store` and its bars 64, and the check finds every stem and the new fallback

#### Scenario: Fallback is placed, not centred
- **WHEN** the new fallback is decoded
- **THEN** the RMS of its left minus right channel is at least a tenth of the RMS of left plus right (the centred release's mono stems gave identical channels)
