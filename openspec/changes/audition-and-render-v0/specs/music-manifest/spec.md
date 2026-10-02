## MODIFIED Requirements

### Requirement: CLI validate command
`spite validate <file...>` SHALL check each named manifest against the schema and the semantic rules above. It SHALL print each error with the file, a JSON Pointer to the offending location, and a message. Messages SHALL be plain language: they SHALL say what is expected, SHALL include the offending value when there is one, and SHALL NOT consist of a raw regular expression or a schema-library keyword. It SHALL exit 0 when every file is valid, 1 when any file is invalid, and 2 on usage errors or unreadable/unparseable files.

#### Scenario: Valid manifest
- **WHEN** `spite validate schema/examples/valid/minimal.json` is run
- **THEN** it reports the file as valid and exits 0

#### Scenario: Invalid manifest
- **WHEN** `spite validate` is run on a manifest with a dangling transition
- **THEN** it prints the file, a JSON Pointer to that transition and a message, and exits 1

#### Scenario: Unparseable input
- **WHEN** `spite validate` is run on a file that is not JSON, or on a path that does not exist
- **THEN** it prints an error that names the file and exits 2

#### Scenario: No arguments
- **WHEN** `spite validate` is run with no files
- **THEN** it prints usage and exits 2

#### Scenario: Plain-language messages
- **WHEN** `spite validate` is run on every file in `schema/examples/invalid/`
- **THEN** no message contains a regular expression such as `^sha256:`, the malformed-hash message names the bad value and says a `sha256:` hash needs 64 lowercase hex characters, the invalid-identifier message names `Drums Loop` and describes the allowed characters, and the unknown-version message names `9.9` and the supported version `0.1`
