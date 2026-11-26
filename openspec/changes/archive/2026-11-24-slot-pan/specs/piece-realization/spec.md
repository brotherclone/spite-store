# Spec Delta

## ADDED Requirements

### Requirement: Pan in the trace
An event from a slot that declares `pan` SHALL carry a `pan` field after `gain`: the slot's number when `pan` is fixed, or the drawn position when it is a range. An event from a slot without `pan` SHALL have no `pan` field, so the trace and its canonical hash for a manifest without `pan` are byte-identical to those before this change.

#### Scenario: Existing goldens unchanged
- **WHEN** `minimal.json` and the placeholder piece are realized for their golden seeds and lengths
- **THEN** every trace has the canonical hash in its existing golden snapshot, and no event has a `pan` field

#### Scenario: Fixed pan copied
- **WHEN** `minimal.json` is given `"pan": -0.6` on one slot and realized with seed `0` for 64 bars
- **THEN** every event from that slot has `pan` `-0.6`, events from other slots have no `pan`, and removing the `pan` fields yields exactly the golden trace for seed `0`

#### Scenario: Fixed pan in the canonical trace
- **WHEN** a trace containing an event with `pan` `-0.6` is serialized canonically
- **THEN** that event is written as `{"bar":…,"beat":…,"slot":…,"clipHash":…,"gain":…,"pan":-0.6}`, with `pan` last

### Requirement: Drawn pan
For a slot whose `pan` is a range `{ min, max }`, each pick that chooses a clip SHALL draw one position: `min + (max − min) × k / 100`, where `k` is the pick's pan draw modulo 101. The draw SHALL be keyed by the section visit ordinal, the slot id and the pick ordinal, on a path separate from the clip pick. No draw SHALL be made for a pick that chooses no clip, or for a fixed or absent `pan`.

#### Scenario: Drawing pan moves no other decision
- **WHEN** `minimal.json` is given `"pan": { "min": -1, "max": 1 }` on one slot and realized with seeds `0`, `42` and `"spite-store"` for 64 bars
- **THEN** removing the `pan` fields from each trace yields exactly that seed's golden trace

#### Scenario: Drawn pan is reproducible
- **WHEN** that manifest is realized 100 times with seed `"spite"` for 64 bars, in Node and in a context with only standard ECMAScript globals
- **THEN** every trace has the same canonical hash

#### Scenario: Drawn positions vary within the range
- **WHEN** that manifest is realized with seed `0` for 64 bars
- **THEN** every `pan` on that slot's events equals `-1 + 2 × k / 100` computed in doubles for some integer `k` from 0 to 100, and at least two events have different positions

#### Scenario: Range resumes exactly
- **WHEN** that manifest is realized for 64 bars with seed `42` in one call, and again in two calls split at bar 30 with the state passed through JSON between them
- **THEN** the two traces are identical, `pan` values included
