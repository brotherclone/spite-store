# Spec Delta

## MODIFIED Requirements

### Requirement: Self-contained production build
`pnpm --filter site build` SHALL write a static site to `site/dist` that works without the development server. For every directory under `pieces/` that contains a `manifest.json`, the build SHALL emit that file's exact bytes at `/pieces/<id>/manifest.json`, and, when the directory has a `versions.json`, that file's exact bytes at `/pieces/<id>/versions.json`. It SHALL NOT emit pack files, READMEs or any audio.

#### Scenario: Manifests emitted
- **WHEN** the site is built
- **THEN** `site/dist/pieces/placeholder/manifest.json` and `site/dist/pieces/the-river-forgets-to-answer/manifest.json` exist, and each is byte-identical to its source under `pieces/`

#### Scenario: Version list emitted
- **WHEN** a piece has a `versions.json` and the site is built
- **THEN** `site/dist/pieces/<id>/versions.json` exists and is byte-identical to its source

#### Scenario: Nothing else from pieces
- **WHEN** the site is built
- **THEN** `site/dist/pieces/` contains no `pack.json`, no `README.md` and no file with an audio extension

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
