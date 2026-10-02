# player-site Specification

## Purpose

A local web page for hearing a piece with `<spite-player>`, with shareable seed permalinks and a development server that serves pieces and locally generated stems by hash.

## Requirements

### Requirement: Placeholder piece page
The site SHALL be a single page that shows `<spite-player>` for the placeholder piece. It SHALL be served in development by `pnpm --filter site dev`, and `pnpm --filter site build` SHALL keep succeeding.

#### Scenario: Page plays the placeholder
- **WHEN** `pnpm stems:placeholder` has been run, the dev server is running and the page is opened
- **THEN** the player loads the placeholder piece and its play button becomes enabled

### Requirement: Seed permalinks
The page SHALL read `seed` and `bars` from its URL query and pass them to the player, using a random seed and 64 bars when absent. When the player announces a new seed or length, the page SHALL update its URL query to match without reloading or adding a history entry.

#### Scenario: Opening a permalink
- **WHEN** the page is opened with `?seed=hello&bars=16`
- **THEN** the player loads seed `hello` for 16 bars

#### Scenario: URL follows the player
- **WHEN** reroll is pressed on the page
- **THEN** the page URL's `seed` parameter equals the new seed, and the browser history length is unchanged

### Requirement: Development serving of pieces and stems
In development, the site SHALL serve files under the repository's `pieces/` directory at `/pieces/`, and the stem with hash `sha256:<hex>` at `/stems/<hex>.wav` from the repository's `.stems/` directory. A request for a stem that is not present SHALL get a 404 response whose body says to run `pnpm stems:placeholder`.

#### Scenario: Stem served by hash
- **WHEN** `/stems/<hex>.wav` is requested for a stem present in `.stems/`
- **THEN** the response is 200 with the file's exact bytes

#### Scenario: Missing stem
- **WHEN** `/stems/<hex>.wav` is requested for a hash not in `.stems/`
- **THEN** the response is 404 and the body mentions `pnpm stems:placeholder`
