# Spec Delta

## ADDED Requirements

### Requirement: Planning with missing stems
The engine SHALL make a render plan from a trace when only some of its stems are present. A voice whose stem is missing SHALL be marked pending. The plan SHALL report its exact horizon: the start frame of the first pending voice, or the full length when none is pending. Every frame before the horizon SHALL render identically to the full plan. With every stem present, the plan SHALL equal the full plan exactly.

#### Scenario: Complete stems give the full plan
- **WHEN** the placeholder piece is planned for seed `42` and 16 bars with every stem present, through the partial planner and through the full planner
- **THEN** both plans are deep-equal, and their renders hash to `fixtures/golden/placeholder.audio.42.json`

#### Scenario: Frames before the horizon are exact
- **WHEN** the placeholder piece is planned for seed `42` and 16 bars with only the stems first used at bar 0 present, and rendered from frame 0 up to the reported horizon
- **THEN** the horizon is the start frame of the first event whose stem is not present, and every rendered frame equals the same frame of the render made with every stem present

#### Scenario: Nothing present
- **WHEN** a trace whose first event is at bar 0 is planned with no stems present
- **THEN** every voice is pending and the horizon is frame 0

#### Scenario: Length while stems are missing
- **WHEN** a plan has pending voices
- **THEN** its length is at least the start frame of the bar after the last realized bar, and it reports that the length is not final
