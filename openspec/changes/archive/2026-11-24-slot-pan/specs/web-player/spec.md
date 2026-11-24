# Spec Delta

## ADDED Requirements

### Requirement: Pan shown in the structure view
In the structure view, the label of a block whose event has `pan` SHALL show its position after the clip id: `L` or `R` followed by the rounded percentage (`|pan| × 100`, halves up), or `C` when that rounds to 0. A block whose event has no `pan` SHALL be labelled as before. The player SHALL play panned events through the same engine renderer as everything else, with no pan processing of its own.

#### Scenario: Positions labelled
- **WHEN** a piece whose slots have `pan` values −0.6, 0.25, 0.004 and none is loaded
- **THEN** those slots' blocks are labelled with their clip id followed by `L60`, `R25`, `C`, and nothing respectively

#### Scenario: Panned piece is sample-identical in the browser
- **WHEN** the panned placeholder variant used by the audio-rendering tests plays for 16 bars with seed `42` in Chromium, Firefox and WebKit
- **THEN** the sha256 of the worklet's float32 output equals the one computed in Node
