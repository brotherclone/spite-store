# Spec Delta

## ADDED Requirements

### Requirement: Pan law
An event with `pan` p SHALL scale its left channel by `1 − p` when p > 0 and by 1 otherwise, and its right channel by `1 + p` when p < 0 and by 1 otherwise, on top of its `gain`. A mono stem feeds both channels. A stereo stem's left and right channels are scaled separately. An event with no `pan` or with `pan` 0 SHALL render exactly as before this change, so `RENDER_FORMAT` is unchanged.

#### Scenario: Mono stem panned left
- **WHEN** a single event with gain 1 and `pan` −0.5 plays a mono stem whose samples are all 0.5
- **THEN** the rendered left samples for that event's body are 0.5 and the right samples are 0.25

#### Scenario: Stereo stem panned hard right
- **WHEN** a single event with gain 0.5 and `pan` 1 plays a stereo stem whose left samples are all 0.4 and right samples all 0.8
- **THEN** the rendered left samples for that event's body are 0 and the right samples are 0.4

#### Scenario: Centre and absent pan render the same samples
- **WHEN** the placeholder piece is rendered for 16 bars with seed `42` as committed, and again with `"pan": 0` added to every slot
- **THEN** both WAVs have the sha256 in the placeholder's golden audio snapshot for seed `42`, and both float32 renderings match its float32 snapshot

#### Scenario: Golden audio unchanged
- **WHEN** the test suite runs after this change
- **THEN** every golden audio and float32 snapshot passes without being regenerated

#### Scenario: Panned render is the same everywhere
- **WHEN** a version of the placeholder piece with fixed and drawn pans on its slots is rendered for 16 bars with seed `42` in Node, in a context with only standard ECMAScript globals, and in Chromium, Firefox and WebKit
- **THEN** the sha256 of the float32 samples is the same in all five
