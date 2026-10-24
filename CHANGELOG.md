# Changelog

## Unreleased

### Security

- Dev dependencies: `vitest`/`@vitest/coverage-v8` 2.x -> 4.1.12, clearing the
  test-toolchain advisories (tinypool GHSA-5gmw-xhrv-c9v3 / GHSA-85c8-ppgw-ccpr,
  esbuild GHSA-67mh-4wv8-2f99, @vitest/mocker GHSA-qxg6-89mg-rqv8). `npm audit` is clean.

### Fixed

- Rule text now quotes the diagnostics tsc actually reports: `TSD028`
  TS5070 (rejected, not "inert"), `TSD081` TS6304, `TSD053` TS5052
  (rejected, not "emits nothing").
- `TSD042`/`TSD082`: the deprecated options and `target: "es3"` were removed
  in TypeScript 5.6 (TS5108/TS5102) and `ignoreDeprecations` no longer
  silences them; `TSD082` therefore stays an `error` under
  `ignoreDeprecations` instead of softening to a `warning`.
- README: the package is not on npm and the npm name belongs to an unrelated
  project, so the install instructions now build from a clone; the severity
  definition matches what the rules do; the first example's command produces
  exactly the output shown.
- Non-major dev-dependency audit fixes.

### Added

- `test/tsc-claims.test.ts`: checks every quoted TS diagnostic against the
  installed TypeScript compiler.
- `SECURITY.md`, `.editorconfig`, `docs/PRODUCTION_READINESS.md`.

## 0.1.0 — 2026-09-01

Initial release.

- 40+ rules over the *effective* configuration (the whole `extends` chain,
  string or TS 5.0 array form, resolved with per-option provenance), each
  explaining the consequence of a setting rather than restating its name.
- A faithful JSONC parser (comments, trailing commas, exact positions) so
  findings point at the real line and column in the file that set the value.
- `tsconfig-doctor [path]` CLI: text or `--json` output, `--min-severity`,
  `--fail-on`, `--ignore`/`--only` code filters, `--list-rules`, wrapped
  prose via `--width`. Exit codes: `0` clean, `1` findings at or above
  `--fail-on`, `2` usage error.
- The repository dogfoods itself: its own `tsconfig.json` and
  `tsconfig.build.json` must produce zero findings, asserted in the test
  suite and in CI.
- Zero runtime dependencies; Node 20+.
