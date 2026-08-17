# Changelog

All notable changes to NovaCheck are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-08-17

### Added

- `ghost-deps` reads install commands out of documentation and agent instruction
  files (`*.md`, `*.mdx`, `*.mdc`, `*.txt`, `*.yml`, `*.rules`, `AGENTS.md`,
  `SKILL.md`) and verifies every package they would install. Supported commands:
  `npm`/`pnpm`/`yarn`/`bun` (`install`, `i`, `add`), `npx`, `pnpx`, `bunx`,
  `pip install`, `uv add`, `uv pip install`, `poetry add`, `pipx install`.
- `--ghosts`, `--only <ids>` and `--skip <ids>` to narrow a scan; `only` and
  `skip` inputs on the GitHub Action.
- The terminal report opens with a `Ghost packages` block listing each name that
  does not resolve, its location, and the install command behind it.
- `examples/ai-slop`, a deliberately unsafe demo project that scores 0/100.
- `scripts/ghost-hunt.ts`, batch research over public repositories, producing a
  markdown report and a JSON dataset; `docs/RESEARCH.md` defines the protocol.

### Changed

- Equally severe findings are ordered by detector, with `ghost-deps` first.

### Fixed

- Manifest entries whose specifier is a git, file, link, workspace, catalog or
  URL protocol are no longer looked up on the registry, and `npm:` aliases now
  resolve to the package actually installed.
- Python import names are mapped to their PyPI distribution before lookup
  (`import yaml` → `PyYAML`, `cv2` → `opencv-python`), and shared namespace roots
  (`google`, `azure`, `zope`) are no longer attributed to a single distribution.

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

[0.5.0]: https://github.com/NovaCoding-G/NovaCheck/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/NovaCoding-G/NovaCheck/compare/v0.3.0...v0.4.0
