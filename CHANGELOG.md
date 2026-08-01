# Changelog

All notable changes to TP Reviews Engine are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The release workflow verifies that an entry exists for the version being tagged,
so an empty section is a release failure rather than an oversight.

**Two versions are tracked separately.** The engine version is this file. The
published payload's `schema_version` is versioned independently in
`schemas/README.md`, because a client website depends on the payload contract
and not on the engine that produced it.

## [Unreleased]

### Added

- Repository initialised: line-ending enforcement, ignore rules, editor
  defaults, and the Node version pin.

[Unreleased]: https://github.com/Vanshmodi-dev/tp-reviews-engine/commits/main
