# player-site Specification

## Purpose

A local web page for hearing a piece with `<spite-player>`, with shareable seed permalinks and a development server that serves pieces and locally generated stems by hash.

## Requirements

### Requirement: Placeholder piece page
The site SHALL be a single page that shows `<spite-player>` for one piece under `pieces/`. A `piece` query parameter that is a valid manifest id SHALL select `/pieces/<piece>/manifest.json`. When it is absent or not a valid id, the page SHALL show the default piece: the placeholder in development, and the production default piece (see site deployment) in a production build. The site SHALL be served in development by `pnpm --filter site dev`, and `pnpm --filter site build` SHALL keep succeeding.

#### Scenario: Page plays the placeholder
- **WHEN** `pnpm stems:placeholder` has been run, the dev server is running and the page is opened
- **THEN** the player loads the placeholder piece and its play button becomes enabled

#### Scenario: Choosing a piece
- **WHEN** the page is opened with `?piece=the-river-forgets-to-answer&seed=hello`
- **THEN** the player loads `/pieces/the-river-forgets-to-answer/manifest.json` with seed `hello`

#### Scenario: Invalid piece ignored
- **WHEN** the page is opened with `?piece=../secret` on the dev server
- **THEN** the player loads the placeholder piece

### Requirement: Seed permalinks
The page SHALL read `seed` and `bars` from its URL query and pass them to the player, using a random seed and 64 bars when absent. When the player announces a new seed or length, the page SHALL update its URL query to match without reloading or adding a history entry. Any `piece` parameter SHALL be kept.

#### Scenario: Opening a permalink
- **WHEN** the page is opened with `?seed=hello&bars=16`
- **THEN** the player loads seed `hello` for 16 bars

#### Scenario: URL follows the player
- **WHEN** reroll is pressed on the page
- **THEN** the page URL's `seed` parameter equals the new seed, and the browser history length is unchanged

#### Scenario: Piece kept on reroll
- **WHEN** the page was opened with `?piece=the-river-forgets-to-answer` and reroll is pressed
- **THEN** the page URL still has `piece=the-river-forgets-to-answer`

### Requirement: Development serving of pieces and stems
In development, the site SHALL serve files under the repository's `pieces/` directory at `/pieces/`, the stem with hash `sha256:<hex>` at `/stems/<hex>.wav`, and the MP3 fallback with hash `sha256:<hex>` at `/stems/<hex>.mp3`, both from the repository's `.stems/` directory, with content types `audio/wav` and `audio/mpeg`. A request for a stem that is not present SHALL get a 404 response whose body says to run `pnpm stems:placeholder` for the placeholder piece or `spite pack` for a recorded piece. A request for a missing fallback SHALL get a 404 whose body says to run `spite fallback`.

#### Scenario: Stem served by hash
- **WHEN** `/stems/<hex>.wav` is requested for a stem present in `.stems/`
- **THEN** the response is 200 with the file's exact bytes

#### Scenario: Missing stem
- **WHEN** `/stems/<hex>.wav` is requested for a hash not in `.stems/`
- **THEN** the response is 404 and the body mentions both `pnpm stems:placeholder` and `spite pack`

#### Scenario: Fallback served by hash
- **WHEN** `/stems/<hex>.mp3` is requested for a file present in `.stems/`
- **THEN** the response is 200 with content type `audio/mpeg` and the file's exact bytes

#### Scenario: Missing fallback
- **WHEN** `/stems/<hex>.mp3` is requested for a hash not in `.stems/`
- **THEN** the response is 404 and the body mentions `spite fallback`
