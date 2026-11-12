# Spec Delta

## MODIFIED Requirements

### Requirement: Manifest input checks
`spite realize`, `spite bounce` and `spite audition` SHALL validate the manifest the same way `spite validate` does before doing anything else. They SHALL print validation errors in the same format and exit 1 on an invalid manifest, and exit 2 on usage errors or an unreadable or unparseable file. They SHALL then check the manifest's engine pin, and without `--ignore-pin` exit 1 on a mismatch, naming each differing format with its pinned and current values, and writing and playing nothing.

#### Scenario: Invalid manifest
- **WHEN** `spite bounce` is run on a manifest with a dangling transition
- **THEN** it prints the file, the JSON Pointer and the message, writes no output, and exits 1

#### Scenario: Bad arguments
- **WHEN** `spite bounce` is run without `--seed`, with `--bars 0`, or with an unknown flag
- **THEN** it prints usage and exits 2

#### Scenario: Mismatched pin
- **WHEN** `spite realize`, `spite bounce` or `spite audition` is run without `--ignore-pin` on a manifest pinned to trace 2 while the engine's trace format is 1
- **THEN** it prints the trace format pinned (2) and current (1) and mentions `--ignore-pin`, writes no output, plays nothing, and exits 1

#### Scenario: Unpinned manifest
- **WHEN** `spite bounce` is run on the placeholder manifest with its `engine` field removed
- **THEN** it renders as before, prints no pin warning, and exits 0
