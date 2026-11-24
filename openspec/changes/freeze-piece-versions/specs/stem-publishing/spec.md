# Spec Delta

## MODIFIED Requirements

### Requirement: Stored files are public and immutable
Every uploaded file SHALL be publicly readable at a stable URL `<store-base>/stems/<name>`, with no random suffix, the content type `audio/flac` for a stem, `audio/mpeg` for an MP3 fallback or `application/json` for a frozen manifest (`<hex>.json`), and a cache lifetime of one year.

#### Scenario: Uploaded file is readable
- **WHEN** a stem has been published and `<store-base>/stems/<hex>.flac` is fetched without credentials
- **THEN** the response is 200, its `Content-Type` is `audio/flac`, and its body hashes to `<hex>`

#### Scenario: Frozen manifest is readable
- **WHEN** a version has been frozen and `<store-base>/stems/<hex>.json` is fetched without credentials
- **THEN** the response is 200, its `Content-Type` is `application/json`, and its body hashes to `<hex>`

#### Scenario: Frozen manifest never replaced
- **WHEN** a frozen manifest `<hex>.json` is already in the store and any `spite` command runs
- **THEN** that file is not uploaded again, replaced or deleted
