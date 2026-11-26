# player-site Specification

## Purpose

A local web page for hearing a piece with `<spite-player>`, with shareable seed permalinks and a development server that serves pieces and locally generated stems by hash.

## Requirements

### Requirement: Placeholder piece page
The site's player page, at `/`, SHALL show `<spite-player>` for one piece under `pieces/`. The site MAY have other pages, such as track pages (see track page). A `piece` query parameter that is a valid manifest id SHALL select that piece, and a `version` parameter SHALL select its version as described in version resolution (see piece versioning). When `piece` is absent or not a valid id, the page SHALL show the default piece: the placeholder in development, and the production default piece (see site deployment) in a production build. The site SHALL be served in development by `pnpm --filter site dev`, and `pnpm --filter site build` SHALL keep succeeding.

#### Scenario: Page plays the placeholder
- **WHEN** `pnpm stems:placeholder` has been run, the dev server is running and the page is opened
- **THEN** the player loads the placeholder piece and its play button becomes enabled

#### Scenario: Choosing a piece
- **WHEN** the page is opened with `?piece=the-river-forgets-to-answer&seed=hello` and the River has no `versions.json`
- **THEN** the player loads `/pieces/the-river-forgets-to-answer/manifest.json` with seed `hello`

#### Scenario: Invalid piece ignored
- **WHEN** the page is opened with `?piece=../secret` on the dev server
- **THEN** the player loads the placeholder piece

#### Scenario: Frozen piece plays its latest version
- **WHEN** the page is opened with `?piece=the-river-forgets-to-answer` and its `versions.json` lists `v1` then `v2`
- **THEN** the player loads `/stems/<hex>.json` for `v2`

#### Scenario: Version by label
- **WHEN** the page is opened with `?piece=the-river-forgets-to-answer&version=v1`
- **THEN** the player loads `/stems/<hex>.json` for `v1`, even when `v2` exists

#### Scenario: Version by hash
- **WHEN** the page is opened with `?piece=the-river-forgets-to-answer&version=<hex>`
- **THEN** the player loads `/stems/<hex>.json` without consulting `versions.json`

#### Scenario: Working manifest on purpose
- **WHEN** the page is opened with `?piece=the-river-forgets-to-answer&version=working` for a frozen piece
- **THEN** the player loads `/pieces/the-river-forgets-to-answer/manifest.json`

#### Scenario: Unknown version
- **WHEN** the page is opened with `version=v9` for a piece that has no `v9`
- **THEN** the page shows an error naming the piece and `v9`, and loads no manifest into the player

#### Scenario: Player page unaffected by track pages
- **WHEN** a piece has tracks and the player page is opened with `?piece=<id>&version=v1&seed=ox-bow&bars=40`
- **THEN** it behaves exactly as it does for a piece without tracks

### Requirement: Seed permalinks
The page SHALL read `seed` and `bars` from its URL query and pass them to the player, using a random seed and 64 bars when absent. When the player announces a new seed or length, the page SHALL update its URL query to match without reloading or adding a history entry. Any `piece` parameter SHALL be kept. When the page is playing a frozen version, the URL SHALL name it in `version` by its label (or by its hash when it has no recorded label); when it is playing the working manifest of a frozen piece, `version` SHALL be `working`; for an unfrozen piece the URL SHALL have no `version`.

#### Scenario: Opening a permalink
- **WHEN** the page is opened with `?seed=hello&bars=16`
- **THEN** the player loads seed `hello` for 16 bars

#### Scenario: URL follows the player
- **WHEN** reroll is pressed on the page
- **THEN** the page URL's `seed` parameter equals the new seed, and the browser history length is unchanged

#### Scenario: Piece kept on reroll
- **WHEN** the page was opened with `?piece=the-river-forgets-to-answer` and reroll is pressed
- **THEN** the page URL still has `piece=the-river-forgets-to-answer`

#### Scenario: Unversioned link gains its version
- **WHEN** the page is opened with `?piece=the-river-forgets-to-answer&seed=hello` while `v2` is the River's latest version
- **THEN** the page URL becomes `?piece=the-river-forgets-to-answer&seed=hello&bars=64&version=v2`, without reloading or adding a history entry

#### Scenario: Copied link survives the next freeze
- **WHEN** a URL with `version=v2&seed=hello&bars=64` is copied, the River is then frozen as `v3`, and the copied URL is opened
- **THEN** the player loads `v2` and the realized trace has the same `traceHash` as before `v3` existed

### Requirement: Development serving of pieces and stems
In development, the site SHALL serve files under the repository's `pieces/` directory at `/pieces/`, the stem with hash `sha256:<hex>` at `/stems/<hex>.flac`, the MP3 fallback with hash `sha256:<hex>` at `/stems/<hex>.mp3`, and the frozen manifest with hash `sha256:<hex>` at `/stems/<hex>.json`, all from the repository's `.stems/` directory, with content types `audio/flac`, `audio/mpeg` and `application/json`. A request for a stem that is not present SHALL get a 404 response whose body says to run `pnpm stems:placeholder` for the placeholder piece or `spite pack` for a recorded piece. A request for a missing fallback SHALL get a 404 whose body says to run `spite fallback`. A request for a missing frozen manifest SHALL get a 404 whose body says to run `spite freeze`.

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

#### Scenario: Frozen manifest served by hash
- **WHEN** `/stems/<hex>.json` is requested for a file present in `.stems/`
- **THEN** the response is 200 with content type `application/json` and the file's exact bytes

#### Scenario: Missing frozen manifest
- **WHEN** `/stems/<hex>.json` is requested for a hash not in `.stems/`
- **THEN** the response is 404 and the body mentions `spite freeze`

### Requirement: Frozen manifest verified before playing
Before giving a frozen manifest to the player, the page SHALL check that its bytes hash to the version's hash and that its `id` equals the requested piece. On a mismatch, or when the file can't be fetched, the page SHALL show an error naming the piece and the version and SHALL NOT play anything.

#### Scenario: Corrupt frozen manifest
- **WHEN** `/stems/<hex>.json` returns bytes that don't hash to `<hex>`
- **THEN** the page shows an error naming the piece and the version, and the player is not given a `src`

#### Scenario: Hash of another piece
- **WHEN** `?piece=placeholder&version=<hex>` names a frozen manifest whose `id` is `the-river-forgets-to-answer`
- **THEN** the page shows an error and plays nothing
