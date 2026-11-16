# Spec Delta

## MODIFIED Requirements

### Requirement: Development serving of pieces and stems
In development, the site SHALL serve files under the repository's `pieces/` directory at `/pieces/`, the stem with hash `sha256:<hex>` at `/stems/<hex>.flac`, and the MP3 fallback with hash `sha256:<hex>` at `/stems/<hex>.mp3`, both from the repository's `.stems/` directory, with content types `audio/flac` and `audio/mpeg`. A request for a stem that is not present SHALL get a 404 response whose body says to run `pnpm stems:placeholder` for the placeholder piece or `spite pack` for a recorded piece. A request for a missing fallback SHALL get a 404 whose body says to run `spite fallback`.

#### Scenario: Stem served by hash
- **WHEN** `/stems/<hex>.flac` is requested for a stem present in `.stems/`
- **THEN** the response is 200 with content type `audio/flac` and the file's exact bytes

#### Scenario: Missing stem
- **WHEN** `/stems/<hex>.flac` is requested for a hash not in `.stems/`
- **THEN** the response is 404 and the body mentions both `pnpm stems:placeholder` and `spite pack`

#### Scenario: WAV stems not served
- **WHEN** `/stems/<hex>.wav` is requested, whether or not `.stems/` holds that file
- **THEN** the response is 404

#### Scenario: Fallback served by hash
- **WHEN** `/stems/<hex>.mp3` is requested for a file present in `.stems/`
- **THEN** the response is 200 with content type `audio/mpeg` and the file's exact bytes

#### Scenario: Missing fallback
- **WHEN** `/stems/<hex>.mp3` is requested for a hash not in `.stems/`
- **THEN** the response is 404 and the body mentions `spite fallback`
