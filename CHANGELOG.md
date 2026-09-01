# Changelog

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
