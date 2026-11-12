# engine-pinning Specification

## Purpose
Ties a released piece to the engine formats it was made with, so a seed permalink keeps meaning one performance. A manifest pinned to other formats is never played as if it were that performance.

## Requirements

### Requirement: Pin compatibility
A manifest SHALL be compatible with the engine when it has no `engine` field, or when its `engine.trace` equals the engine's trace format and its `engine.render` equals the engine's render format. Any other pin SHALL be a mismatch. The check SHALL report each number that differs, the pinned and current values, and whether the piece was made with an older or a newer engine.

#### Scenario: Matching pin
- **WHEN** a manifest pinned to `{ "trace": 1, "render": 1 }` is checked by an engine whose trace and render formats are both 1
- **THEN** it is compatible

#### Scenario: Unpinned manifest
- **WHEN** a manifest without `engine` is checked
- **THEN** it is compatible

#### Scenario: Newer pin
- **WHEN** a manifest pinned to `{ "trace": 2, "render": 1 }` is checked by an engine whose trace and render formats are both 1
- **THEN** it is a mismatch naming the trace format, pinned 2 and current 1, made with a newer engine, and the render format is not named

#### Scenario: Older pin
- **WHEN** a manifest pinned to `{ "trace": 1, "render": 1 }` is checked by an engine whose trace format is 2 and render format is 1
- **THEN** it is a mismatch naming the trace format, pinned 1 and current 2, made with an older engine

### Requirement: Pin command
`spite pin <manifest>` SHALL validate the manifest as `spite validate` does, then report its pin against the running engine. It SHALL exit 0 when the pin matches, and 1 when the manifest is unpinned or mismatched, printing the pinned and current formats. It SHALL never change the file without `--update`.

#### Scenario: Pinned to current formats
- **WHEN** `spite pin` is run on a manifest pinned to the current formats
- **THEN** it prints that the piece is pinned to the current formats and exits 0

#### Scenario: Unpinned
- **WHEN** `spite pin` is run on a manifest without `engine`
- **THEN** it prints that the piece is not pinned, leaves the file byte-identical, and exits 1

#### Scenario: Mismatched
- **WHEN** `spite pin` is run on a manifest pinned to trace 2 while the engine's trace format is 1
- **THEN** it prints both trace formats, leaves the file byte-identical, and exits 1

#### Scenario: Invalid manifest
- **WHEN** `spite pin` is run on a manifest with a dangling transition
- **THEN** it prints the JSON Pointer and message as `spite validate` does, and exits 1

### Requirement: Writing the pin
`spite pin <manifest> --update` SHALL set `engine` to the running engine's trace and render formats and leave every other field and its formatting unchanged. When it replaces a different pin, it SHALL warn that existing seed links to the piece will play a different performance, and exit 0.

#### Scenario: Pinning an unpinned manifest
- **WHEN** `spite pin --update` is run on a manifest without `engine`
- **THEN** the manifest gains `"engine": { "trace": 1, "render": 1 }`, still validates, is otherwise unchanged, and the command exits 0

#### Scenario: Re-pinning
- **WHEN** `spite pin --update` is run on a manifest pinned to trace 2 while the engine's trace format is 1
- **THEN** the pin becomes `{ "trace": 1, "render": 1 }`, a warning about existing seed links is printed, and the command exits 0

#### Scenario: Already current
- **WHEN** `spite pin --update` is run on a manifest already pinned to the current formats
- **THEN** the file is byte-identical afterwards and the command exits 0

### Requirement: Ignoring the pin
`spite realize`, `spite bounce` and `spite audition` SHALL accept `--ignore-pin`. With it, a mismatched manifest SHALL be realized and rendered by the current engine, after a warning on stderr naming both formats. Output for a compatible manifest SHALL be identical with or without the flag.

#### Scenario: Hearing the current engine's version
- **WHEN** `spite bounce --ignore-pin` is run on a manifest pinned to trace 2 while the engine's trace format is 1
- **THEN** it prints a warning naming both trace formats, writes the WAV, and exits 0

#### Scenario: Flag has no effect on a compatible manifest
- **WHEN** `spite realize --json` is run on a pinned, compatible manifest with and without `--ignore-pin`
- **THEN** both outputs are byte-identical and neither prints a warning
