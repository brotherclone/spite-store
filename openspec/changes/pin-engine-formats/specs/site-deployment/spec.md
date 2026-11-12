# Spec Delta

## ADDED Requirements

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
