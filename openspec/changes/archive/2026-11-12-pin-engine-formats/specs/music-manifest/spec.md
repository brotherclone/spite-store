# Spec Delta

## ADDED Requirements

### Requirement: Engine pin field
The schema SHALL accept an optional top-level `engine` object with exactly two fields, `trace` and `render`, each an integer of at least 1. It records the engine formats the piece was released with. Validation SHALL NOT compare it with the running engine. Manifests without `engine` SHALL stay valid.

#### Scenario: Valid pin
- **WHEN** a manifest that is otherwise valid declares `"engine": { "trace": 1, "render": 1 }`
- **THEN** validation passes

#### Scenario: Pin to formats the engine doesn't have
- **WHEN** a manifest that is otherwise valid declares `"engine": { "trace": 7, "render": 3 }`
- **THEN** validation passes

#### Scenario: Malformed pin rejected
- **WHEN** a manifest's `engine` has a `trace` of `0`, a `render` of `"1"`, or no `render`
- **THEN** validation fails and reports a JSON Pointer under `/engine` naming the offending field

#### Scenario: Unknown pin field rejected
- **WHEN** a manifest's `engine` contains an extra field `version`
- **THEN** validation fails and reports `/engine`

### Requirement: Realization ignores the pin
The `engine` field SHALL NOT affect realization or rendering. For any manifest and seed, adding, removing or changing `engine` SHALL leave the trace and the rendered audio byte-identical.

#### Scenario: Trace unchanged by a pin
- **WHEN** _The River Forgets to Answer_ is realized for 64 bars with seeds `0`, `42` and `"spite-store"`, with its `engine` field, with `engine` removed, and with `engine` set to `{ "trace": 9, "render": 9 }`
- **THEN** the three traces for each seed have the same canonical JSON, equal to the hash in that seed's existing golden snapshot

#### Scenario: Render unchanged by a pin
- **WHEN** the placeholder piece is rendered for 16 bars with seed `42`, as committed and with `engine` removed
- **THEN** both WAVs have the sha256 recorded in the placeholder's golden audio snapshot for seed `42`
