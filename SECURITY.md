# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's advisory form:
https://github.com/hellpuffyt/tsconfig-doctor/security/advisories/new

Do not open a public issue for a suspected vulnerability.

## Scope

tsconfig-doctor reads `tsconfig.json` files and the files their `extends`
chains name, and never executes anything. In scope: crashes, hangs or
unbounded resource use on crafted config files, and output that misreports
what the TypeScript compiler does.

Note: this package is not published to npm. The `tsconfig-doctor` package on
the npm registry is an unrelated project; reports about it belong to its own
repository.

## Supported versions

Only the latest commit on `main` is supported.
