# Spec Delta

## MODIFIED Requirements

### Requirement: Publish command
`spite publish <manifest...> [--stems <dir>]` SHALL upload, for every named manifest, the file of every clip in its catalogue and of its fallback (if any), stored by name `<hex>.flac` (or `<hex>.mp3` for an MP3 fallback). It SHALL upload every catalogued clip, not only those some seed uses. It SHALL read files from the stems directory, which defaults to `.stems/`.

#### Scenario: First publish
- **WHEN** `spite publish pieces/the-river-forgets-to-answer/manifest.json` is run with all 24 stems and the fallback in `.stems/` and an empty store
- **THEN** 25 files are uploaded, a summary reports 25 uploaded and 0 already present, and it exits 0

#### Scenario: Several manifests share a stem
- **WHEN** two named manifests reference the same hash
- **THEN** that file is uploaded at most once

#### Scenario: Re-publishing after the switch to FLAC
- **WHEN** the River has been re-packed as FLAC and is published to a store that holds its earlier WAV stems and its fallback
- **THEN** 24 `.flac` files are uploaded, the fallback is reported as already present, and no `.wav` file is uploaded or removed

### Requirement: Stored files are public and immutable
Every uploaded file SHALL be publicly readable at a stable URL `<store-base>/stems/<name>`, with no random suffix, the content type `audio/flac` for a stem or `audio/mpeg` for an MP3 fallback, and a cache lifetime of one year.

#### Scenario: Uploaded file is readable
- **WHEN** a stem has been published and `<store-base>/stems/<hex>.flac` is fetched without credentials
- **THEN** the response is 200, its `Content-Type` is `audio/flac`, and its body hashes to `<hex>`
