# Spec Delta

## MODIFIED Requirements

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
