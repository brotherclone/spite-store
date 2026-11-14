# Spec Delta

## MODIFIED Requirements

### Requirement: Fallback input checks
`spite fallback` SHALL validate the manifest the same way `spite validate` does, and check its stems the same way `spite bounce` does, before encoding anything. It SHALL exit 1 on an invalid manifest, and 2 on usage errors or missing stems, writing nothing in either case. It SHALL also exit 1, writing nothing, when the manifest's engine pin doesn't match the running engine, and it SHALL NOT accept `--ignore-pin`.

#### Scenario: Missing stem
- **WHEN** `spite fallback` is run with a stems directory that lacks a stem the seed uses
- **THEN** it names that clip id and hash, writes no file, and exits 2

#### Scenario: No seed
- **WHEN** `spite fallback` is run without `--seed`
- **THEN** it prints usage and exits 2

#### Scenario: Mismatched pin
- **WHEN** `spite fallback --update` is run on a manifest pinned to trace 2 while the engine's trace format is 1
- **THEN** it prints both trace formats, writes no MP3, leaves the manifest byte-identical, and exits 1

#### Scenario: No override
- **WHEN** `spite fallback` is run with `--ignore-pin`
- **THEN** it prints usage and exits 2
