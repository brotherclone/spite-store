# Spec Delta

## Purpose

Moves a piece's stems and fallback recording from an author's local stems directory into the public stem store by content hash, and checks that a deployment can reach every file its manifests reference.

## ADDED Requirements

### Requirement: Publish command
`spite publish <manifest...> [--stems <dir>]` SHALL upload, for every named manifest, the file of every clip in its catalogue and of its fallback (if any), stored by name `<hex>.wav` (or `<hex>.mp3` for an MP3 fallback). It SHALL upload every catalogued clip, not only those some seed uses. It SHALL read files from the stems directory, which defaults to `.stems/`.

#### Scenario: First publish
- **WHEN** `spite publish pieces/the-river-forgets-to-answer/manifest.json` is run with all 24 stems and the fallback in `.stems/` and an empty store
- **THEN** 25 files are uploaded, a summary reports 25 uploaded and 0 already present, and it exits 0

#### Scenario: Several manifests share a stem
- **WHEN** two named manifests reference the same hash
- **THEN** that file is uploaded at most once

### Requirement: Publishing is idempotent
`spite publish` SHALL NOT upload a file that the store already holds under the same name. Running it twice in a row SHALL upload nothing the second time. A stored file SHALL never be replaced or deleted.

#### Scenario: Second run uploads nothing
- **WHEN** `spite publish` is run twice on the same manifest with the same stems
- **THEN** the second run uploads 0 files, reports every file as already present, and exits 0

### Requirement: Local files verified before upload
Before uploading anything, `spite publish` SHALL check that every referenced file exists locally and that its sha256 equals its hash. If any is missing or doesn't match, it SHALL name each one's clip id (or `fallback`) and hash, upload nothing, and exit 2.

#### Scenario: Missing local stem
- **WHEN** `spite publish` is run and one referenced stem is absent from the stems directory
- **THEN** it names that clip id and hash, uploads nothing, and exits 2

#### Scenario: Corrupt local stem
- **WHEN** a file in the stems directory does not hash to its name
- **THEN** it names that clip id and hash as a mismatch, uploads nothing, and exits 2

### Requirement: Store credentials
`spite publish` SHALL read the store's write credential from the `BLOB_READ_WRITE_TOKEN` environment variable. When it is unset, it SHALL say so, upload nothing, and exit 2. It SHALL never print the credential.

#### Scenario: No credential
- **WHEN** `spite publish` is run without `BLOB_READ_WRITE_TOKEN` set
- **THEN** it prints a message naming `BLOB_READ_WRITE_TOKEN`, uploads nothing, and exits 2

### Requirement: Stored files are public and immutable
Every uploaded file SHALL be publicly readable at a stable URL `<store-base>/stems/<name>`, with no random suffix, the content type `audio/wav` or `audio/mpeg`, and a cache lifetime of one year.

#### Scenario: Uploaded file is readable
- **WHEN** a stem has been published and `<store-base>/stems/<hex>.wav` is fetched without credentials
- **THEN** the response is 200, its `Content-Type` is `audio/wav`, and its body hashes to `<hex>`

### Requirement: Reachability check
`spite publish --check <base-url> <manifest...>` SHALL upload nothing and need no credential. For each referenced file it SHALL request `<base-url><name>`. It SHALL list every file that is not reachable with a 2xx status, by clip id and hash, and exit 1 if there are any, or 0 if all are reachable. A network error SHALL count as unreachable.

#### Scenario: All reachable
- **WHEN** `--check` is run after a successful publish of the same manifests
- **THEN** it reports every file as reachable and exits 0

#### Scenario: One missing
- **WHEN** `--check` is run and one referenced hash is absent from the store
- **THEN** it names that clip id and hash and exits 1

#### Scenario: Usage
- **WHEN** `spite publish` is run with no manifests, or `--check` without a URL
- **THEN** it prints usage and exits 2

### Requirement: Manifest input checks for publish
`spite publish` SHALL validate each named manifest the same way `spite validate` does before reading or uploading any file. It SHALL print validation errors in the same format and exit 1 if any manifest is invalid.

#### Scenario: Invalid manifest
- **WHEN** `spite publish` is run on a manifest with a dangling transition
- **THEN** it prints the file, the JSON Pointer and the message, uploads nothing, and exits 1
