# Production readiness — tsconfig-doctor

Tested commit: `087722a` (audit/production-readiness; this file was added in
the following docs-only commit). Date: 2026-10-22.

## Scope and architecture

A zero-runtime-dependency CLI and library that loads a `tsconfig.json` with a
recovering JSONC parser, resolves the full `extends` chain (relative, array,
package) with per-option provenance, and runs 56 rules plus 10 load-failure
codes over the effective configuration, reporting what each setting changes.

## Platforms and prerequisites

- Node >= 20 (`engines`); CI runs Node 20/22/24 on Linux/Windows/macOS.
  Verified locally on macOS 27 (Apple M5), Node 24.19.0, npm 11.17.0.
  Windows was not run locally.
- Not published to npm (the npm name belongs to an unrelated package).

## Clean-clone verification

| Step | Exit / result |
|---|---|
| `git clone`, `npm install`, `npm run build` | 0 |
| `node dist/bin.js <clone dir>` | 0, "no findings" (the repo's own config) |
| README first example (`examples --only TSD029`) | output identical to the README block (`diff` empty) |
| `node dist/bin.js --version` | `0.1.0` |
| `npm run typecheck`, `lint`, `test`, `coverage` | all 0; 363 passed |
| CI dogfood: `tsconfig.build.json` → 0; `examples --fail-on warning` → 1 | as documented |

`npm link` was not run (it changes the global npm prefix on a shared machine).

## Commands and results (CI steps)

| Check | Command | Before | After |
|---|---|---|---|
| Install | `npm ci` | 0 | 0 |
| Tests | `npm test` | 0 — 356 passed | 0 — 363 passed, 0 failed, 0 skipped |
| Typecheck | `npm run typecheck` | 0 | 0 |
| Lint | `npm run lint` | 0 | 0 |
| Coverage | `npm run coverage` | 0 — statements 99.29% | 0 — statements 99.29% |
| Build + bin | `npm run build && node dist/bin.js --version` | 0 | 0 |
| Dogfood | own configs → 0, `examples --fail-on warning` → 1 | as expected | as expected |
| Parser robustness | 200,000-deep arrays, 100,000-deep objects, binary garbage, unterminated string | diagnostics, no crash | unchanged |
| Runtime dependency audit | `npm audit --omit=dev` | 0 (no runtime deps) | 0 |
| Full audit | `npm audit` | dev-only critical/high (vitest 2 chain) | brace-expansion, source-map-js fixed; vitest chain needs vitest 5, not done |

## CI status

Default branch: success (latest `main` run). Audit branch: pending until pushed.

## Bugs found and fixed

Rule claims were compared with real compilers installed in scratch
directories (TypeScript 5.4.5, 5.5.4, 5.6.3, 5.7.3, 5.8.3, 5.9.3):

1. `TSD028` said TS5071 and "inert"; tsc reports **TS5070** and refuses to build.
2. `TSD081` said TS5069; tsc reports **TS6304**.
3. `TSD053` said the option "emits nothing"; tsc **rejects** it (TS5052).
4. `TSD042`/`TSD082` said "an error since 5.5, removed in 6.0" and softened
   `TSD082` to a warning under `ignoreDeprecations`. Measured: 5.4.5 and 5.5.4
   reject (TS5107/TS5101) unless `ignoreDeprecations: "5.0"`; 5.6.3–5.9.3
   reject (TS5108/TS5102) regardless. `TSD082` now stays an error.
5. README install instructions pointed at an unrelated npm package; severity
   definition did not match `TSD001`/`TSD021`/`TSD062`/`TSD085`; the first
   example's output did not match its command.

Regression tests: `test/tsc-claims.test.ts` (verifies each quoted TS code
against the installed compiler) and the updated `TSD082` test in
`test/rules.test.ts` (changed with a written reason).

## Security review

- Secret scan of tree and full history: no hits.
- Input is local config files; nothing is executed; the parser is recursion-
  safe on the deep-nesting probes above.
- Supply chain: the npm-name collision is documented in README and
  `SECURITY.md`; publishing under this name is not possible without renaming.
- CI already used `contents: read`; actions pinned to tags (unchanged).

## Known limitations

- Rules other than those that quote a TS diagnostic describe behaviour from
  TypeScript's documented semantics; they are unit-tested against the rule
  logic, not against compiled programs.
- `tsc-claims` checks the TypeScript version installed in `node_modules`; the
  5.4/5.5 history was checked once by hand (above), not in CI.
- Remaining dev-only advisories need vitest 5.

## Acceptance checklist

| # | Item | Expected | Command / test | Result | Reference |
|---|---|---|---|---|---|
| 1 | Effective config through `extends` | merge rules, provenance | `test/extends.test.ts` | pass | `src/config.ts` |
| 2 | Cycles / missing bases | reported once, no hang | `test/extends.test.ts` | pass | `src/config.ts` |
| 3 | Malformed JSONC | diagnostics, recovery | `test/jsonc.test.ts`, probes | pass | `src/jsonc.ts` |
| 4 | Quoted tsc diagnostics are real | codes match installed tsc | `test/tsc-claims.test.ts` | pass | `src/rules.ts` |
| 5 | Clean config is silent | no findings | `test/rules.test.ts`, dogfood | pass | `src/rules.ts` |
| 6 | Exit codes | 0 / 1 / 2 as documented | `test/cli.test.ts`, dogfood | pass | `src/cli.ts` |
| 7 | JSON output stable | sorted | `test/report.test.ts` | pass | `src/report.ts` |
| 8 | README example output | identical | clean-clone diff | pass | `README.md` |

## Classification proposal

**READY FOR DOCUMENTED SCOPE** for use from a clone (proposal; pending
audit-branch CI and the lead's verification). Distribution via npm is
blocked by the name collision — an owner decision.
