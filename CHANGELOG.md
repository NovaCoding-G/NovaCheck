# Changelog

All notable changes to NovaCheck are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-08-07

### Added

- Explicit incomplete-scan diagnostics and `failOnIncomplete` policy support.
- Registry request timeouts, bounded retries, and concurrent package lookups.
- Automated npm publishing with provenance from GitHub Releases.
- Packed-package smoke tests across supported Node.js versions and platforms.

### Changed

- The default Trust Score threshold is now 85.
- The GitHub Action runs the exact published npm package for release builds.
- GitHub Actions dependencies are pinned to immutable commits.

### Fixed

- Git-tracked `.env` detection on Windows.
- GitHub Code Scanning uploads for informational signals without file
  locations.

## [0.3.0] - 2026-08-05

- Initial public release with eight security and AI-provenance detectors,
  policy enforcement, terminal/HTML/SARIF reports, and a GitHub Action.

[0.4.0]: https://github.com/NovaCoding-G/NovaCheck/compare/v0.3.0...v0.4.0
