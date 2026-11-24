# Spec Delta

## MODIFIED Requirements

### Requirement: Self-contained production build
`pnpm --filter site build` SHALL write a static site to `site/dist` that works without the development server. For every directory under `pieces/` that contains a `manifest.json`, the build SHALL emit that file's exact bytes at `/pieces/<id>/manifest.json`, and, when the directory has a `versions.json`, that file's exact bytes at `/pieces/<id>/versions.json`. For every track in the directory's `release.json`, it SHALL emit the track page at `/pieces/<id>/tracks/<track-id>/index.html`. An invalid `release.json` SHALL fail the build, naming the file and its errors. It SHALL NOT emit pack files, READMEs, `release.json` or any audio.

#### Scenario: Manifests emitted
- **WHEN** the site is built
- **THEN** `site/dist/pieces/placeholder/manifest.json` and `site/dist/pieces/the-river-forgets-to-answer/manifest.json` exist, and each is byte-identical to its source under `pieces/`

#### Scenario: Version list emitted
- **WHEN** a piece has a `versions.json` and the site is built
- **THEN** `site/dist/pieces/<id>/versions.json` exists and is byte-identical to its source

#### Scenario: Track pages emitted
- **WHEN** a piece's `release.json` records the tracks `first-light` and `eddy` and the site is built
- **THEN** `site/dist/pieces/<id>/tracks/first-light/index.html` and `site/dist/pieces/<id>/tracks/eddy/index.html` exist, and no other file exists under `site/dist/pieces/<id>/tracks/`

#### Scenario: Invalid release file fails the build
- **WHEN** a piece's `release.json` has a duplicate track id and the site is built
- **THEN** the build fails with a message naming the file and the duplicate id

#### Scenario: Nothing else from pieces
- **WHEN** the site is built
- **THEN** `site/dist/pieces/` contains no `pack.json`, no `README.md`, no `release.json` and no file with an audio extension

## ADDED Requirements

### Requirement: Track page origin
The production build SHALL take the site's absolute origin for track pages' share metadata from the `VITE_SITE_ORIGIN` setting in `site/.env.production`. Development SHALL leave it unset.

#### Scenario: Production origin used
- **WHEN** the production site is built with `VITE_SITE_ORIGIN=https://example.test`
- **THEN** every track page's `og:url` starts with `https://example.test/`
