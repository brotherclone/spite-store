# Spec Delta

## MODIFIED Requirements

### Requirement: Stems resolved from storage
In production, a request for `/stems/<file>` SHALL be answered with that file from the public stem store, under the same name. The page SHALL keep using `stems="/stems/"`, and the browser SHALL see the stems as same-origin.

#### Scenario: Stem by hash in production
- **WHEN** a published stem `sha256:<hex>` is requested at `https://<deployment>/stems/<hex>.flac`
- **THEN** the response is 200, its `Content-Type` is `audio/flac`, and its body hashes to `<hex>`

#### Scenario: Unpublished stem
- **WHEN** `/stems/<hex>.flac` is requested for a hash that was never published
- **THEN** the response is 404
