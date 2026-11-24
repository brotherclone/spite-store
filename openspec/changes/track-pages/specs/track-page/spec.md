# Spec Delta

## Purpose

Gives every track a stable page on the store that can be linked from anywhere. The page plays the fixed recording, offers it for download, credits the people who made it, and leads the listener to the live, generative piece.

## ADDED Requirements

### Requirement: Track page URL
Every track in a piece's `release.json` SHALL have a page at `/pieces/<piece-id>/tracks/<track-id>/`. A track id that is not recorded SHALL get the site's ordinary 404.

#### Scenario: Page exists
- **WHEN** the River's `release.json` records the track `first-light` and the site is built
- **THEN** `/pieces/the-river-forgets-to-answer/tracks/first-light/` returns 200 with the track page

#### Scenario: Unknown track
- **WHEN** `/pieces/the-river-forgets-to-answer/tracks/nope/` is requested
- **THEN** the response is 404

### Requirement: Track page contents
The page SHALL show the track's title, the piece's title (from its working manifest), the version label, the seed, the length in bars and as minutes and seconds (from `frames` at 48 kHz, rounded down), and every credit in order as name and role. All text from the release file and the manifest SHALL be HTML-escaped.

#### Scenario: Details shown
- **WHEN** the page for a track with title `First Light`, version `v1`, seed `ox-bow`, 40 bars and 6,432,000 frames is opened
- **THEN** it shows `First Light`, `The River Forgets to Answer`, `v1`, `ox-bow`, `40 bars` and `2:14`

#### Scenario: Markup in a title is text
- **WHEN** a track's title is `<b>Loud</b>`
- **THEN** the page shows the literal text `<b>Loud</b>`, and the document contains no `b` element from it

### Requirement: Fixed recording on the page
The page SHALL have an `audio` element with controls whose source is `/stems/<audio-hex>.flac` with type `audio/flac`, and no preload beyond metadata. The page SHALL work without scripts.

#### Scenario: Audio element
- **WHEN** the track page is loaded
- **THEN** it has one `audio` element with `controls`, `preload="metadata"` and a source of `/stems/<audio-hex>.flac`, and the page has no `script` element

### Requirement: Download link
The page SHALL link to `/stems/<audio-hex>.flac` with a `download` attribute naming the file `<piece-id>--<track-id>.flac`, and SHALL state that it is a 24-bit, 48 kHz FLAC.

#### Scenario: Download named for the track
- **WHEN** the download link on the `first-light` page is used
- **THEN** the browser saves `the-river-forgets-to-answer--first-light.flac`, and its bytes hash to the track's `audio`

### Requirement: Hand-off to the live piece
The page SHALL link to the player page at `/?piece=<piece-id>&version=<label>&seed=<seed>&bars=<bars>`, saying that the piece plays differently every time and that this link starts from this track's performance.

#### Scenario: Live link plays the same performance
- **WHEN** the live link on a track page is followed
- **THEN** the player page loads that version with that seed and bars, and the realized trace's `traceHash` equals that of the trace the track was rendered from

### Requirement: Share metadata
The page head SHALL include `<title>` as `<track title> · <piece title> · Spite Store`, a `description` meta, and Open Graph `og:title`, `og:description`, `og:type` `music.song`, `og:url` (the absolute page URL) and `og:audio` (the absolute FLAC URL). The absolute origin SHALL come from build configuration, not the request.

#### Scenario: Preview tags present
- **WHEN** the `first-light` page is built with the site origin `https://example.test`
- **THEN** its head has `og:url` `https://example.test/pieces/the-river-forgets-to-answer/tracks/first-light/` and `og:audio` `https://example.test/stems/<audio-hex>.flac`

#### Scenario: No origin configured
- **WHEN** the site is built without an origin
- **THEN** the build still succeeds, and the page leaves out `og:url` and `og:audio` but keeps the other tags

### Requirement: Track pages in development
In development, the dev server SHALL serve each track page at the same URL as production, built from the same code and the current `release.json`, `versions.json` and working manifest, so a change to `release.json` shows on reload.

#### Scenario: Dev page reflects edits
- **WHEN** the dev server is running and a track's title is changed in `release.json`
- **THEN** reloading the page shows the new title without restarting the server

#### Scenario: Same HTML as the build
- **WHEN** the same track page is fetched from the dev server and read from a production build without an origin
- **THEN** the two HTML documents are identical
