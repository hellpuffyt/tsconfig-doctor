# Contributing

Thanks for looking into tsconfig-doctor.

## Setup

```console
npm ci
npm test          # vitest, in-memory — no child processes, no temp dirs
npm run typecheck # both projects: src and test
npm run lint
npm run build     # emits dist/, which the bin entry point imports
```

## Ground rules

- **Zero runtime dependencies.** `dependencies` is empty on purpose and a
  test asserts it stays that way.
- **Every rule explains a consequence, not a setting.** A rule whose message
  could be produced by reading the option's name does not ship. Say what the
  compiler will silently do to the build, then the fix.
- **Findings carry positions.** The JSONC parser keeps line/column for every
  member so a finding can point into the actual file — including a file
  higher up the `extends` chain.
- **The CLI is tested in memory.** `run()` takes its file system (`Host`),
  cwd and output streams as arguments and returns an exit code. Do not
  introduce `process.*` outside `src/bin.ts`.
- **The repo must stay clean under its own tool.** `test/package.test.ts`
  audits `tsconfig.json` and `tsconfig.build.json`; if your change makes a
  rule fire on them, fix the config or the rule — never the test.
