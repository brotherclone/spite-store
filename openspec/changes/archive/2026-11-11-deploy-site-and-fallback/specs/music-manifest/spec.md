# Spec Delta

## ADDED Requirements

### Requirement: Fallback recording field
The schema SHALL accept an optional top-level `fallback` object with exactly these fields: `hash` (a `sha256:` content hash as for clips), `type` (`"audio/mpeg"`, the only allowed value), `seed` (a non-empty string) and `bars` (a positive integer). It names one fixed recording of the piece and the performance it was rendered from. Manifests without `fallback` SHALL stay valid.

#### Scenario: Valid fallback
- **WHEN** a manifest that is otherwise valid declares `"fallback": { "hash": "sha256:<64 hex>", "type": "audio/mpeg", "seed": "spite-store", "bars": 64 }`
- **THEN** validation passes

#### Scenario: Malformed fallback rejected
- **WHEN** a manifest's `fallback` has the hash `fallback.mp3`, the type `audio/ogg`, a `bars` of `0`, or a missing `seed`
- **THEN** validation fails and reports a JSON Pointer under `/fallback` naming the offending field

#### Scenario: Unknown fallback field rejected
- **WHEN** a manifest's `fallback` contains an extra field `url`
- **THEN** validation fails and reports `/fallback`

### Requirement: Realization ignores the fallback
The `fallback` field SHALL NOT affect realization or rendering. For any manifest and seed, adding, removing or changing `fallback` SHALL leave the trace and the rendered audio byte-identical.

#### Scenario: Trace unchanged by a fallback
- **WHEN** _The River Forgets to Answer_ is realized for 64 bars with seeds `0`, `42` and `"spite-store"`, both with its `fallback` field and with that field removed
- **THEN** each pair of traces has the same canonical JSON, and each equals the hash in that seed's existing golden snapshot

#### Scenario: Render unchanged by a fallback
- **WHEN** the placeholder piece is bounced for 16 bars with seed `42`, once as committed and once with a `fallback` field added
- **THEN** both WAV files have the sha256 recorded in the placeholder's golden audio snapshot for seed `42`
