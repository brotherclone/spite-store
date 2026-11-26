# site-deployment Specification

## Purpose
Builds the site for production and hosts it publicly, so a released piece can be heard at a stable URL with its stems served by content hash from storage outside the repository.

## Requirements

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

### Requirement: Production default piece
In a production build, the page SHALL show _The River Forgets to Answer_ when the URL has no valid `piece` parameter, resolving its version as for any piece: its latest frozen version, or its working manifest while it is unfrozen. Development SHALL keep the placeholder as its default. In both, a valid `piece` parameter SHALL select that piece.

#### Scenario: Production home page
- **WHEN** the production site is opened at `/` with no query while the River is unfrozen
- **THEN** the player loads `/pieces/the-river-forgets-to-answer/manifest.json`

#### Scenario: Production home page after a freeze
- **WHEN** the production site is opened at `/` with no query and the River's latest version is `v1`
- **THEN** the player loads `/stems/<hex>.json` for `v1`, and the page URL names `piece=the-river-forgets-to-answer` and `version=v1`

#### Scenario: Placeholder still reachable
- **WHEN** the production site is opened with `?piece=placeholder`
- **THEN** the player loads `/pieces/placeholder/manifest.json`

### Requirement: Stems resolved from storage
In production, a request for `/stems/<file>` SHALL be answered with that file from the public stem store, under the same name. The page SHALL keep using `stems="/stems/"`, and the browser SHALL see the stems as same-origin.

#### Scenario: Stem by hash in production
- **WHEN** a published stem `sha256:<hex>` is requested at `https://<deployment>/stems/<hex>.flac`
- **THEN** the response is 200, its `Content-Type` is `audio/flac`, and its body hashes to `<hex>`

#### Scenario: Unpublished stem
- **WHEN** `/stems/<hex>.flac` is requested for a hash that was never published
- **THEN** the response is 404

### Requirement: Deployment refuses missing stems
The hosted build SHALL run the stem check of `spite publish --check` against the store for every manifest it emits, and `spite freeze --check` for every piece it emits. If any referenced stem or fallback file, or any recorded version's manifest or the files it references, is unreachable or does not match its hash, or any `versions.json` is invalid, the build SHALL fail and no deployment SHALL be published.

#### Scenario: Missing stem blocks the deploy
- **WHEN** a manifest on the branch references a hash not present in the store and the branch is pushed
- **THEN** the build fails, the build log names the clip id and hash, and the previous deployment stays live

#### Scenario: Complete store deploys
- **WHEN** every referenced hash is present in the store and the branch is pushed
- **THEN** the build succeeds and a deployment is published

#### Scenario: Unpublished version blocks the deploy
- **WHEN** a `versions.json` on the branch records a version whose `<hex>.json` is not in the store, and the branch is pushed
- **THEN** the build fails, the build log names the piece, label and hash, and the previous deployment stays live

#### Scenario: Invalid version list blocks the deploy
- **WHEN** a `versions.json` on the branch repeats a label and the branch is pushed
- **THEN** the build fails and the build log names the file and the repeated label

### Requirement: Branch deployments
The hosting project SHALL be connected to the repository on GitHub. A push to `master` SHALL publish to production. A push to any other branch SHALL publish a preview deployment at its own URL, without changing production.

#### Scenario: Preview from a feature branch
- **WHEN** a commit is pushed to a branch other than `master`
- **THEN** a preview deployment is built for that commit, and the production URL still serves the previous `master` deployment

#### Scenario: Production from master
- **WHEN** a commit is pushed to `master` and its build succeeds
- **THEN** the production URL serves that commit

### Requirement: Caching of content-addressed files
Files under `/stems/`, including frozen manifests, SHALL be served with a cache lifetime of at least one year and marked immutable, because their names are their content hashes. Manifests and version lists under `/pieces/` SHALL NOT be cached for longer than five minutes, so a republished manifest or a new version reaches listeners promptly.

#### Scenario: Stem cache headers
- **WHEN** a published stem is requested in production
- **THEN** its `Cache-Control` header allows caching for at least 31,536,000 seconds and includes `immutable`

#### Scenario: Frozen manifest cache headers
- **WHEN** a frozen manifest `/stems/<hex>.json` is requested in production
- **THEN** its `Cache-Control` header allows caching for at least 31,536,000 seconds and includes `immutable`

#### Scenario: Manifest cache headers
- **WHEN** a manifest is requested in production
- **THEN** its `Cache-Control` header does not allow caching for more than 300 seconds

#### Scenario: Version list cache headers
- **WHEN** `/pieces/<id>/versions.json` is requested in production
- **THEN** its `Cache-Control` header does not allow caching for more than 300 seconds

### Requirement: Deployed pieces are pinned
The hosted build SHALL check the engine pin of every manifest it emits, before building the site. An unpinned manifest SHALL fail the build. A manifest pinned to formats other than the deployed engine's SHALL NOT fail the build, but the build log SHALL warn that the piece will play its fallback, or will not play at all when it has none.

#### Scenario: Unpinned piece blocks the deploy
- **WHEN** a branch is pushed on which a piece's manifest has no `engine` field
- **THEN** the build fails, the log names the manifest and says it is not pinned, and no deployment is published

#### Scenario: Stranded piece deploys with a warning
- **WHEN** the deploy check runs on a manifest with a fallback that is pinned to trace 2 while the engine's trace format is 1
- **THEN** the check passes and prints a warning naming the manifest, both trace formats and that the piece will play its fallback

#### Scenario: Stranded piece without a fallback
- **WHEN** the deploy check runs on a manifest without a fallback that is pinned to other formats
- **THEN** the check passes and prints a warning that the piece will not play

#### Scenario: Pinned pieces deploy
- **WHEN** every emitted manifest is pinned to the current formats and every stem is reachable
- **THEN** the check passes with no pin warning

### Requirement: Track page origin
The production build SHALL take the site's absolute origin for track pages' share metadata from the `VITE_SITE_ORIGIN` setting in `site/.env.production`. Development SHALL leave it unset.

#### Scenario: Production origin used
- **WHEN** the production site is built with `VITE_SITE_ORIGIN=https://example.test`
- **THEN** every track page's `og:url` starts with `https://example.test/`
