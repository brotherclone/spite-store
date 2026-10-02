# Spec Delta

## Purpose

Provides the only source of randomness for realization. Every random value is a pure function of a seed and a named decision path, so outcomes are reproducible everywhere and stable as pieces grow.

## ADDED Requirements

### Requirement: Decisions are keyed by seed and decision path
Every random value SHALL be a pure function of (seed, decision path, draw index). It SHALL NOT depend on how many other values were drawn before it, in what order, or on any other path.

#### Scenario: Order independence
- **WHEN** values for paths `["a"]` and `["b"]` are drawn under seed `7`, first in the order a-then-b and then in the order b-then-a
- **THEN** the value for `["a"]` is identical in both orders, and so is the value for `["b"]`

#### Scenario: Unrelated draws do not disturb existing ones
- **WHEN** the values for path `["x", 3]` are recorded under seed `7`, and then 1,000 extra draws on other paths are inserted before drawing `["x", 3]` again
- **THEN** the second set of values for `["x", 3]` equals the recorded values exactly

### Requirement: Identical results on every runtime
The same (seed, path, draw index) SHALL produce bit-identical output on every supported runtime (Node LTS and current evergreen browsers, including inside an AudioWorklet). Randomness SHALL NOT use platform-provided entropy, time, locale, or floating-point operations whose results the language does not exactly specify.

#### Scenario: Known-answer vectors
- **WHEN** the published known-answer vectors (seed, path, draw index → expected 32-bit output) are evaluated
- **THEN** every output matches its expected value exactly

#### Scenario: No ambient randomness
- **WHEN** `Math.random` and `Date` are replaced with functions that throw, and values are then drawn
- **THEN** drawing succeeds and returns the same values as without the replacement

### Requirement: Seed normalization
A seed SHALL be either a string or a non-negative safe integer. An integer seed SHALL be treated as identical to its base-10 string form. Any other seed value SHALL be rejected with an error.

#### Scenario: Integer and string seeds coincide
- **WHEN** the same path is drawn with seed `42` and with seed `"42"`
- **THEN** the values are identical

#### Scenario: Invalid seed rejected
- **WHEN** a value is drawn with seed `-1`, `1.5`, `NaN`, or `null`
- **THEN** an error is raised that identifies the seed as invalid

### Requirement: Distinct inputs diverge
Different seeds, or different paths under the same seed, SHALL produce independent-looking sequences.

#### Scenario: Different seeds diverge
- **WHEN** the first 64 draws on path `["p"]` are taken under seed `1` and under seed `2`
- **THEN** the two sequences differ in at least 60 of the 64 positions

#### Scenario: Similar paths diverge
- **WHEN** draws are taken on paths `["slot", "a", 1]` and `["slot", "a", 2]` and `["slot", "a1"]` under one seed
- **THEN** no two of these paths produce the same first value

### Requirement: Uniform unit value
`rand` SHALL return a number in the half-open interval [0, 1).

#### Scenario: Range bounds
- **WHEN** 100,000 values are drawn across distinct paths
- **THEN** every value is ≥ 0 and < 1, and the sample mean is within 0.01 of 0.5

### Requirement: Chance
`chance(p)` SHALL return true with probability `p`. `p` SHALL be a number in [0, 1]. `chance(0)` SHALL always be false, `chance(1)` SHALL always be true, and any other `p` SHALL be rejected.

#### Scenario: Edge probabilities
- **WHEN** `chance(0)` and `chance(1)` are each evaluated on 10,000 distinct paths
- **THEN** `chance(0)` is false every time and `chance(1)` is true every time

#### Scenario: Out-of-range probability
- **WHEN** `chance(1.2)` or `chance(-0.1)` is evaluated
- **THEN** an error is raised

### Requirement: Weighted pick
A weighted pick over a non-empty list of finite, non-negative weights with a positive total SHALL return index `i` with probability `weight[i] / total`. An item with weight 0 SHALL never be returned. An empty list, a list whose weights are all 0, or a negative or non-finite weight SHALL be rejected.

#### Scenario: Weighted picks converge over 10k trials
- **WHEN** weights `[1, 2, 7]` are picked on 10,000 distinct paths under a fixed seed
- **THEN** each index's observed frequency is within 0.02 of 0.1, 0.2 and 0.7 respectively

#### Scenario: Zero weight never chosen
- **WHEN** weights `[0, 1, 0]` are picked on 10,000 distinct paths
- **THEN** index 1 is returned every time

#### Scenario: Invalid weights rejected
- **WHEN** a pick is requested over `[]`, `[0, 0]`, or `[1, -1]`
- **THEN** an error is raised

### Requirement: Integer range
`range(lo, hi)` SHALL return a uniformly distributed integer `n` with `lo ≤ n ≤ hi`, where `lo` and `hi` are safe integers, `lo ≤ hi`, and `hi - lo < 2^32`.

#### Scenario: Inclusive bounds and uniformity
- **WHEN** `range(1, 6)` is drawn on 60,000 distinct paths
- **THEN** every result is an integer from 1 to 6 inclusive, and each value's frequency is within 0.01 of 1/6

#### Scenario: Degenerate range
- **WHEN** `range(5, 5)` is drawn
- **THEN** the result is 5
