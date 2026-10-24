/**
 * The rules.
 *
 * Every rule answers three questions in this order, and a rule that cannot
 * answer all three does not belong here:
 *
 * 1. What does the compiler actually do differently because of this setting?
 * 2. What breaks, or quietly changes meaning, as a result?
 * 3. What should be typed instead — or why the setting is defensible anyway?
 *
 * "`strict` is off" is not a finding. "Every type in the project silently
 * includes `null` and `undefined`, so a field annotated `string` can be
 * `undefined` at runtime with no error anywhere" is.
 *
 * Rules are pure functions of a {@link RuleContext}. They never touch the file
 * system, so the whole set can be run against a fixture in memory.
 */

import type { JsonValue } from './jsonc.js';
import type { OptionRecord, ResolvedConfig, Severity } from './types.js';

/** What a rule returns when it fires. */
export interface RuleHit {
  readonly severity: Severity;
  readonly title: string;
  readonly consequence: string;
  readonly fix: string;
  /** The option to attribute the finding to; defaults to the rule's `option`. */
  readonly option?: string | undefined;
}

/** A single diagnosis, keyed by a stable code. */
export interface Rule {
  readonly code: string;
  /** The option the rule is about, used to locate the finding in a file. */
  readonly option?: string | undefined;
  readonly run: (ctx: RuleContext) => RuleHit | RuleHit[] | undefined;
}

/**
 * Options `strict` turns on. Deliberately spelled out rather than derived:
 * the list has grown over TypeScript releases, and a rule that says "strict is
 * off so X is off" must be right about which X.
 */
export const STRICT_FAMILY = [
  'noImplicitAny',
  'noImplicitThis',
  'alwaysStrict',
  'strictBindCallApply',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictPropertyInitialization',
  'useUnknownInCatchVariables',
] as const;

/** Script targets in order, so rules can ask "older than ES2020?". */
const TARGET_ORDER = [
  'es3',
  'es5',
  'es6',
  'es2015',
  'es2016',
  'es2017',
  'es2018',
  'es2019',
  'es2020',
  'es2021',
  'es2022',
  'es2023',
  'es2024',
  'esnext',
];

function targetRank(target: string): number {
  const index = TARGET_ORDER.indexOf(target);
  // es6 and es2015 are the same target spelled two ways.
  if (target === 'es6') return TARGET_ORDER.indexOf('es2015');
  return index;
}

/** Everything a rule is allowed to look at. */
export class RuleContext {
  constructor(readonly config: ResolvedConfig) {}

  /** The winning record for an option, including which file declared it. */
  get(name: string): OptionRecord | undefined {
    return this.config.options.get(name);
  }

  /** The winning value for an option, or `undefined` if never set. */
  value(name: string): JsonValue | undefined {
    return this.config.options.get(name)?.value;
  }

  /** An explicitly set boolean. `undefined` means "not written anywhere". */
  bool(name: string): boolean | undefined {
    const value = this.value(name);
    return typeof value === 'boolean' ? value : undefined;
  }

  /** An explicitly set string, lowercased — tsconfig enum values are case-insensitive. */
  text(name: string): string | undefined {
    const value = this.value(name);
    return typeof value === 'string' ? value.toLowerCase() : undefined;
  }

  /** An explicitly set array. */
  list(name: string): readonly JsonValue[] | undefined {
    const value = this.value(name);
    return Array.isArray(value) ? value : undefined;
  }

  /** A top-level key such as `include`, `files` or `exclude`. */
  topLevel(name: string): OptionRecord | undefined {
    return this.config.topLevel.get(name);
  }

  /** `strict` as the compiler sees it: explicit value, defaulting to `false`. */
  get strict(): boolean {
    return this.bool('strict') ?? false;
  }

  /**
   * The effective value of a strict-family flag: its own explicit value if it
   * has one, otherwise whatever `strict` says.
   */
  effective(flag: (typeof STRICT_FAMILY)[number]): boolean {
    return this.bool(flag) ?? this.strict;
  }

  /** The effective script target. `tsc` still defaults to ES5 when unset. */
  get target(): string {
    return this.text('target') ?? 'es5';
  }

  /** True when the target is older than the given one. */
  targetBelow(other: string): boolean {
    return targetRank(this.target) < targetRank(other);
  }

  get module(): string | undefined {
    return this.text('module');
  }

  /** True when this project is expected to write JavaScript. */
  get emits(): boolean {
    return this.bool('noEmit') !== true && this.bool('emitDeclarationOnly') !== true;
  }
}

function hit(
  severity: Severity,
  title: string,
  consequence: string,
  fix: string,
  option?: string,
): RuleHit {
  return { severity, title, consequence, fix, option };
}

/**
 * Builds one rule per strict-family flag, since the shape is identical and only
 * the prose differs. Each fires when the flag is *effectively* off, and says
 * whether that is because it was written `false` or because `strict` is absent.
 */
function strictFlagRule(
  code: string,
  option: (typeof STRICT_FAMILY)[number],
  severity: Severity,
  title: string,
  consequence: string,
  fix: string,
): Rule {
  return {
    code,
    option,
    run(ctx) {
      if (ctx.effective(option)) return undefined;
      const explicit = ctx.bool(option) === false;
      const reason = explicit
        ? `\`${option}\` is set to false explicitly.`
        : `\`${option}\` is off because \`strict\` is not enabled — it has no default of its own.`;
      return hit(severity, title, `${reason} ${consequence}`, fix, explicit ? option : 'strict');
    },
  };
}

/** Options tsc accepts. Anything else in `compilerOptions` is silently ignored. */
export const KNOWN_OPTIONS: ReadonlySet<string> = new Set([
  'allowArbitraryExtensions', 'allowImportingTsExtensions', 'allowJs', 'allowSyntheticDefaultImports',
  'allowUmdGlobalAccess', 'allowUnreachableCode', 'allowUnusedLabels', 'alwaysStrict',
  'assumeChangesOnlyAffectDirectDependencies', 'baseUrl', 'charset', 'checkJs', 'composite',
  'customConditions', 'declaration', 'declarationDir', 'declarationMap', 'diagnostics',
  'disableReferencedProjectLoad', 'disableSizeLimit', 'disableSolutionSearching',
  'disableSourceOfProjectReferenceRedirect', 'downlevelIteration', 'emitBOM',
  'emitDeclarationOnly', 'emitDecoratorMetadata', 'erasableSyntaxOnly', 'esModuleInterop',
  'exactOptionalPropertyTypes', 'experimentalDecorators', 'explainFiles',
  'extendedDiagnostics', 'forceConsistentCasingInFileNames', 'generateCpuProfile',
  'ignoreDeprecations', 'importHelpers', 'importsNotUsedAsValues', 'incremental',
  'inlineSourceMap', 'inlineSources', 'isolatedDeclarations', 'isolatedModules', 'jsx',
  'jsxFactory', 'jsxFragmentFactory', 'jsxImportSource', 'keyofStringsOnly', 'lib',
  'libReplacement', 'listEmittedFiles', 'listFiles', 'mapRoot', 'maxNodeModuleJsDepth',
  'module', 'moduleDetection', 'moduleResolution', 'moduleSuffixes', 'newLine', 'noCheck',
  'noEmit', 'noEmitHelpers', 'noEmitOnError', 'noErrorTruncation', 'noFallthroughCasesInSwitch',
  'noImplicitAny', 'noImplicitOverride', 'noImplicitReturns', 'noImplicitThis',
  'noImplicitUseStrict', 'noLib', 'noPropertyAccessFromIndexSignature', 'noResolve',
  'noStrictGenericChecks', 'noUncheckedIndexedAccess', 'noUncheckedSideEffectImports',
  'noUnusedLocals', 'noUnusedParameters', 'out', 'outDir', 'outFile', 'paths', 'plugins',
  'preserveConstEnums', 'preserveSymlinks', 'preserveValueImports', 'preserveWatchOutput',
  'pretty', 'reactNamespace', 'removeComments', 'resolveJsonModule', 'resolvePackageJsonExports',
  'resolvePackageJsonImports', 'rewriteRelativeImportExtensions', 'rootDir', 'rootDirs',
  'skipDefaultLibCheck', 'skipLibCheck', 'sourceMap', 'sourceRoot', 'strict',
  'strictBindCallApply', 'strictBuiltinIteratorReturn', 'strictFunctionTypes',
  'strictNullChecks', 'strictPropertyInitialization', 'stripInternal',
  'suppressExcessPropertyErrors', 'suppressImplicitAnyIndexErrors', 'target', 'traceResolution',
  'tsBuildInfoFile', 'typeRoots', 'types', 'useDefineForClassFields',
  'useUnknownInCatchVariables', 'verbatimModuleSyntax',
]);

/**
 * Options TypeScript 5.0 deprecated. Since 5.5 they are an error unless
 * `ignoreDeprecations` is set, and TypeScript 6.0 removes them.
 */
export const DEPRECATED_OPTIONS: ReadonlyMap<string, string> = new Map([
  ['charset', 'files have been read as UTF-8 regardless of this setting for years; it does nothing at all'],
  ['importsNotUsedAsValues', 'superseded by `verbatimModuleSyntax`, which controls the same emit more predictably'],
  ['keyofStringsOnly', 'makes `keyof` skip numeric and symbol keys, which no longer matches the language'],
  ['noImplicitUseStrict', 'modules are always strict mode in every current target'],
  ['noStrictGenericChecks', 'disables a soundness check on generic signatures with no modern justification'],
  ['out', 'replaced by `outFile`, which at least validates the module setting'],
  ['preserveValueImports', 'superseded by `verbatimModuleSyntax`'],
  ['suppressExcessPropertyErrors', 'hides the check that catches misspelled object literal keys'],
  ['suppressImplicitAnyIndexErrors', 'hides every implicit-any produced by index access, including real ones'],
]);

/** Legacy resolution modes that predate the `exports` field in package.json. */
const LEGACY_RESOLUTION = new Set(['node', 'node10', 'classic']);

/** Module settings that imply a modern resolver. */
const MODERN_MODULES = new Set(['es2015', 'es2020', 'es2022', 'esnext', 'node16', 'node18', 'nodenext', 'preserve']);

export const RULES: readonly Rule[] = [
  // ---------------------------------------------------------------- type safety
  {
    code: 'TSD001',
    option: 'strict',
    run(ctx) {
      if (ctx.strict) return undefined;
      const off = STRICT_FAMILY.filter((flag) => !ctx.effective(flag));
      if (off.length === 0) return undefined;
      return hit(
        'error',
        `${off.length} type-safety checks are off because \`strict\` is not enabled`,
        `\`strict\` is not a style preference; it is the switch that gives ${STRICT_FAMILY.length} separate checks a default of "on". With it absent, these are off: ${off.join(', ')}. The compiler still reports errors, so the project looks type-checked — it is simply checking much less than the annotations promise.`,
        'Set `"strict": true`. On an existing codebase, enable it and then turn individual flags back off with a comment and a plan, so the remaining debt is visible.',
      );
    },
  },
  strictFlagRule(
    'TSD002',
    'strictNullChecks',
    'error',
    'every type silently includes null and undefined',
    'With this off, `null` and `undefined` are members of every type: a value annotated `string` may be `undefined` at runtime and no error is reported anywhere. Optional chaining and non-null assertions become decoration, and `Array.prototype.find` is typed as always returning an element. This is the single flag that decides whether the type system models the failure mode that actually causes production crashes.',
    'Set `"strictNullChecks": true` (or `"strict": true`). Expect a large one-off error count on an existing codebase; almost every one of them is a real unhandled absence.',
  ),
  strictFlagRule(
    'TSD003',
    'noImplicitAny',
    'error',
    'untyped parameters become `any` and stop being checked',
    'A parameter or variable the compiler cannot infer becomes `any` silently. `any` is contagious: everything derived from it is unchecked too, so one untyped callback parameter can switch off checking for a whole call graph while every file still reports zero errors.',
    'Set `"noImplicitAny": true` (or `"strict": true`) and annotate what it reports. Where a type is genuinely unknown, write `unknown` — it forces a narrowing at the point of use instead of disabling checks downstream.',
  ),
  strictFlagRule(
    'TSD004',
    'strictFunctionTypes',
    'warning',
    'function parameters are checked bivariantly, so wrong callbacks are accepted',
    'Parameter positions are compared bivariantly rather than contravariantly: a handler taking `Dog` is accepted where one taking `Animal` is required, and the mismatch surfaces at runtime as a missing property. Note that this flag deliberately does not apply to parameters of methods declared with method syntax, so interfaces written with `handle(x: Dog): void` remain bivariant either way.',
    'Set `"strictFunctionTypes": true` (or `"strict": true`), and declare callback properties as arrow-typed fields (`handle: (x: Dog) => void`) rather than methods so the check applies to them.',
  ),
  strictFlagRule(
    'TSD005',
    'strictPropertyInitialization',
    'warning',
    'class fields declared non-optional may never be assigned',
    'A field declared `name: string` with no initialiser and no assignment in the constructor is accepted, and reads `undefined` at runtime. This is the usual source of "cannot read properties of undefined" in classes built by dependency injection or by an async `init()`.',
    'Set `"strictPropertyInitialization": true` (it also needs `strictNullChecks`). Use `name!: string` only where a framework really does assign the field before use, and prefer moving the assignment into the constructor.',
  ),
  strictFlagRule(
    'TSD006',
    'useUnknownInCatchVariables',
    'warning',
    'the variable in every `catch` is typed `any`',
    'A caught value is typed `any` rather than `unknown`, so `catch (e) { console.log(e.message) }` type-checks. Anything can be thrown in JavaScript — strings, `undefined`, a rejected non-Error — and the property access then throws a second error from inside the error handler, replacing the original failure with a confusing one.',
    'Set `"useUnknownInCatchVariables": true` (or `"strict": true`) and narrow with `e instanceof Error` before touching properties.',
  ),
  strictFlagRule(
    'TSD007',
    'strictBindCallApply',
    'info',
    '`bind`, `call` and `apply` accept arguments of any type',
    'These three methods are typed with their loose fallback signatures, so `fn.call(this, 1, 2, 3)` is accepted no matter what `fn` takes. Argument-count and argument-type errors that the compiler could catch statically are passed through to runtime.',
    'Set `"strictBindCallApply": true` (or `"strict": true`).',
  ),
  strictFlagRule(
    'TSD008',
    'noImplicitThis',
    'info',
    '`this` is `any` inside functions where it cannot be inferred',
    'In a standalone `function` used as a callback, `this` is typed `any`, so every property read off it is unchecked. The value of `this` at runtime depends entirely on how the function is called, which is exactly the case where a static check earns its keep.',
    'Set `"noImplicitThis": true` (or `"strict": true`) and add a `this` parameter where the receiver is real.',
  ),
  strictFlagRule(
    'TSD009',
    'alwaysStrict',
    'info',
    'emitted files may not be in strict mode',
    'Without this, `"use strict"` is only emitted for files TypeScript already considers modules. In a non-module file, sloppy-mode semantics apply: assigning to an undeclared identifier creates a global instead of throwing, and `this` in a plain function call is the global object rather than `undefined`.',
    'Set `"alwaysStrict": true` (or `"strict": true`).',
  ),
  {
    code: 'TSD010',
    option: 'noUncheckedIndexedAccess',
    run(ctx) {
      if (ctx.bool('noUncheckedIndexedAccess') === true) return undefined;
      if (!ctx.effective('strictNullChecks')) return undefined;
      return hit(
        'warning',
        'indexing an array or record is typed as always succeeding',
        '`items[0]` is typed `T`, not `T | undefined`, and `record[key]` likewise. The compiler therefore proves nothing about out-of-range and missing-key access — the two commonest ways a `strictNullChecks` project still throws "cannot read properties of undefined". Note this flag is not part of `strict`, so a project can be fully strict and still have it off.',
        'Set `"noUncheckedIndexedAccess": true`. Loops written with `for (const item of items)` are unaffected; the errors it raises are all real index accesses that need a guard or a `.at()` check.',
      );
    },
  },
  {
    code: 'TSD011',
    option: 'exactOptionalPropertyTypes',
    run(ctx) {
      if (ctx.bool('exactOptionalPropertyTypes') === true) return undefined;
      if (!ctx.effective('strictNullChecks')) return undefined;
      return hit(
        'info',
        'an optional property accepts an explicit `undefined`, which is not the same as absent',
        'For `{ name?: string }`, passing `{ name: undefined }` is accepted. The two differ everywhere it matters: `"name" in obj` is true, `Object.keys` includes it, `JSON.stringify` drops it, and a database or `PATCH` layer that distinguishes "unset" from "set to null" gets the wrong instruction.',
        'Set `"exactOptionalPropertyTypes": true` and write `name?: string | undefined` where an explicit undefined really is allowed.',
      );
    },
  },
  {
    code: 'TSD012',
    option: 'noImplicitOverride',
    run(ctx) {
      if (ctx.bool('noImplicitOverride') === true) return undefined;
      return hit(
        'info',
        'a method can stop overriding its base without any error',
        'Overrides are not marked, so renaming or removing a base-class method leaves the subclass method behind as a new, never-called method. Nothing in the type system notices; the behaviour simply reverts to the base implementation.',
        'Set `"noImplicitOverride": true` and mark real overrides with the `override` keyword.',
      );
    },
  },
  {
    code: 'TSD013',
    option: 'noFallthroughCasesInSwitch',
    run(ctx) {
      if (ctx.bool('noFallthroughCasesInSwitch') === true) return undefined;
      return hit(
        'info',
        'a `switch` case that forgets its `break` falls through silently',
        'A non-empty case without `break`, `return` or `throw` runs the next case as well. Deliberate fall-through is rare; a forgotten `break` looks identical and produces a wrong result rather than a crash, which makes it hard to spot in review and in tests.',
        'Set `"noFallthroughCasesInSwitch": true`. Deliberate fall-through stays legal by writing the shared cases with empty bodies.',
      );
    },
  },
  {
    code: 'TSD014',
    option: 'noImplicitReturns',
    run(ctx) {
      if (ctx.bool('noImplicitReturns') === true) return undefined;
      return hit(
        'info',
        'a function can return a value on some paths and `undefined` on others',
        'If any code path falls off the end of a function that returns a value elsewhere, the return type quietly gains `undefined` (or, without `strictNullChecks`, does not even do that). A missing `return` in one branch of an `if` is the usual cause.',
        'Set `"noImplicitReturns": true`.',
      );
    },
  },
  {
    code: 'TSD015',
    option: 'noPropertyAccessFromIndexSignature',
    run(ctx) {
      if (ctx.bool('noPropertyAccessFromIndexSignature') === true) return undefined;
      return hit(
        'info',
        'a typo in a dotted property name is indistinguishable from a real key',
        'On a type with an index signature — `process.env` being the everyday example — `config.databaseUrl` and `config.databsaeUrl` both type-check and both return `string`. The declared keys and the arbitrary ones become impossible to tell apart at the call site.',
        'Set `"noPropertyAccessFromIndexSignature": true`, which forces `config["anything"]` bracket syntax for keys that are not declared.',
      );
    },
  },
  {
    code: 'TSD016',
    option: 'strictPropertyInitialization',
    run(ctx) {
      if (ctx.bool('strictPropertyInitialization') !== true) return undefined;
      if (ctx.effective('strictNullChecks')) return undefined;
      return hit(
        'error',
        '`strictPropertyInitialization` is rejected outright without `strictNullChecks`',
        'tsc refuses this combination (TS5052) rather than ignoring it, so the project does not compile at all. The check is meaningless without `strictNullChecks`, because an uninitialised field would be typed as its declared type anyway.',
        'Enable `strictNullChecks`, or remove `strictPropertyInitialization`.',
      );
    },
  },
  {
    code: 'TSD017',
    option: 'skipLibCheck',
    run(ctx) {
      if (ctx.bool('skipLibCheck') !== true) return undefined;
      return hit(
        'warning',
        'type errors inside `.d.ts` files are not reported, including your own',
        'The check is skipped for every declaration file, not just the ones in `node_modules`. Two incompatible copies of `@types/node`, a dependency shipping declarations that reference types it does not depend on, and — if this project emits declarations — broken output of your own all pass silently. Consumers of your package then hit the errors you never saw.',
        'It is a reasonable trade for build speed on an application. For a published library, run a second `tsc --noEmit --skipLibCheck false` over the emitted declarations in CI so the output is checked at least once.',
      );
    },
  },
  {
    code: 'TSD018',
    option: 'allowJs',
    run(ctx) {
      if (ctx.bool('allowJs') !== true) return undefined;
      if (ctx.bool('checkJs') === true) return undefined;
      return hit(
        'warning',
        'JavaScript files are compiled and trusted, but never type-checked',
        '`allowJs` pulls `.js` files into the program and emits them; without `checkJs` the compiler never checks their contents. Their inferred exports are still consumed by TypeScript files, so a wrong shape in a `.js` file propagates into checked code as fact.',
        'Set `"checkJs": true` to check them, or exclude the JavaScript from the program if it is vendored code you do not intend to fix. `// @ts-check` and `// @ts-nocheck` let you move file by file.',
      );
    },
  },
  {
    code: 'TSD019',
    run(ctx) {
      const hits: RuleHit[] = [];
      if (ctx.bool('allowUnreachableCode') === true) {
        hits.push(
          hit(
            'info',
            'code after a `return` is accepted without even a warning',
            'The default for this option is `undefined`, which reports unreachable code as an editor suggestion. Setting it to `true` removes that signal entirely, so the dead half of a function that someone stopped editing halfway through stays invisible.',
            'Remove `allowUnreachableCode`, or set it to `false` to make unreachable code an error.',
            'allowUnreachableCode',
          ),
        );
      }
      if (ctx.bool('allowUnusedLabels') === true) {
        hits.push(
          hit(
            'info',
            'a mistyped object literal can be silently parsed as a labelled statement',
            '`{ foo: bar }` written as a statement is a label, not an object. With unused labels allowed there is no diagnostic, so the expression the author meant is simply never evaluated.',
            'Remove `allowUnusedLabels`, or set it to `false`.',
            'allowUnusedLabels',
          ),
        );
      }
      return hits;
    },
  },

  // ------------------------------------------------------------ modules and interop
  {
    code: 'TSD020',
    option: 'esModuleInterop',
    run(ctx) {
      if (ctx.bool('esModuleInterop') === true) return undefined;
      const module = ctx.module;
      // node16/nodenext and preserve turn interop on by default.
      if (module !== undefined && ['node16', 'node18', 'nodenext', 'preserve'].includes(module)) {
        return undefined;
      }
      return hit(
        'warning',
        'CommonJS packages are imported with a shape that does not match how Node loads them',
        'Without interop, `import * as express from "express"` is callable and `import express from "express"` is an error — the exact opposite of what happens under real ESM and under every bundler. Code written to satisfy the compiler in this mode has to be rewritten the day the project moves to ESM, and the same import line means two different things in two halves of a monorepo.',
        'Set `"esModuleInterop": true`. It changes emit, so do it as its own commit; the compiler will point at the namespace imports that must become default imports.',
      );
    },
  },
  {
    code: 'TSD021',
    option: 'allowSyntheticDefaultImports',
    run(ctx) {
      if (ctx.bool('allowSyntheticDefaultImports') !== true) return undefined;
      if (ctx.bool('esModuleInterop') === true) return undefined;
      const module = ctx.module;
      if (module !== undefined && ['node16', 'node18', 'nodenext', 'preserve'].includes(module)) {
        return undefined;
      }
      return hit(
        'error',
        'default imports type-check but are `undefined` at runtime',
        'This flag tells the *checker* to pretend a CommonJS module has a default export. It does not tell the *emitter* to create one — that is what `esModuleInterop` does. So `import fs from "fs"` compiles without complaint and evaluates to `undefined`, and the failure appears as a property access on undefined somewhere unrelated.',
        'Set `"esModuleInterop": true`, which implies this flag and also emits the interop helper. Setting this one alone is almost never what anybody wants.',
      );
    },
  },
  {
    code: 'TSD022',
    option: 'moduleResolution',
    run(ctx) {
      const resolution = ctx.text('moduleResolution');
      if (resolution === undefined || !LEGACY_RESOLUTION.has(resolution)) return undefined;
      const module = ctx.module;
      if (module === undefined || !MODERN_MODULES.has(module)) return undefined;
      return hit(
        'warning',
        `\`moduleResolution: "${resolution}"\` ignores the \`exports\` map of every dependency`,
        `The \`${resolution}\` algorithm predates conditional exports. It resolves by walking directories and reading \`main\`/\`types\`, so for a package that publishes its types only through \`exports\` you get either no types at all or the wrong ones — often an old CommonJS build whose signatures differ from the ESM one you actually run. The build succeeds, so the mismatch shows up as behaviour, not as an error. Meanwhile \`module: "${module}"\` says the output is modern.`,
        'Use `"moduleResolution": "bundler"` when a bundler resolves the imports, or `"nodenext"` when Node does. Both honour `exports`.',
      );
    },
  },
  {
    code: 'TSD023',
    option: 'module',
    run(ctx) {
      if (ctx.text('module') !== undefined) return undefined;
      return hit(
        'warning',
        'the module format of the emitted JavaScript is decided by the target, not by you',
        'With `module` unset, tsc derives it from `target`: CommonJS for ES3/ES5, and ES2015-style modules for anything newer. Raising the target therefore silently changes every emitted file from `require` to `import`, which either breaks the runtime or changes how the package is consumed — a one-word edit with a packaging-level consequence.',
        'Set `module` explicitly. `"nodenext"` for Node, `"esnext"` when a bundler consumes the output, `"commonjs"` for a CommonJS package.',
      );
    },
  },
  {
    code: 'TSD024',
    option: 'verbatimModuleSyntax',
    run(ctx) {
      if (ctx.bool('verbatimModuleSyntax') === true) return undefined;
      return hit(
        'warning',
        'imports used only for their types are deleted from the output',
        'tsc elides any import whose bindings all turn out to be types. That is usually invisible and occasionally fatal: an import kept for its side effects disappears, a decorator-metadata or DI container that resolves by runtime identity loses the module, and the same source transpiled by esbuild or swc — which cannot know a name is a type — keeps the import, so the two builds differ.',
        'Set `"verbatimModuleSyntax": true`. It requires `import type` on type-only imports, which makes the emit a mechanical consequence of the source rather than of type resolution.',
      );
    },
  },
  {
    code: 'TSD025',
    option: 'isolatedModules',
    run(ctx) {
      if (ctx.bool('isolatedModules') === true) return undefined;
      return hit(
        'warning',
        'code that tsc accepts cannot be compiled by esbuild, swc, Babel or Vite',
        'Single-file transpilers see one file at a time and cannot tell a re-exported type from a re-exported value. Without this flag tsc happily accepts `export { Foo } from "./types"` where `Foo` is an interface, plus `const enum` members and ambient `declare` in a module — all of which produce a runtime error or a missing export under any transpile-only build. The type-check passes, the bundle is broken.',
        'Set `"isolatedModules": true`, even if tsc is your only compiler today: test runners such as Vitest and Jest with swc already transpile this way.',
      );
    },
  },
  {
    code: 'TSD026',
    option: 'moduleDetection',
    run(ctx) {
      const detection = ctx.text('moduleDetection');
      if (detection === 'force') return undefined;
      return hit(
        'info',
        'a file with no import or export is a global script, and its declarations leak',
        'Under the default `auto` detection, whether a file is a module depends on whether it happens to contain a top-level `import` or `export`. Delete the last export from a file and every `const` in it becomes a global, colliding with identically named locals elsewhere and producing "cannot redeclare block-scoped variable" in files that were not edited.',
        'Set `"moduleDetection": "force"` so every file is a module regardless of its contents.',
      );
    },
  },
  {
    code: 'TSD027',
    option: 'allowImportingTsExtensions',
    run(ctx) {
      if (ctx.bool('allowImportingTsExtensions') !== true) return undefined;
      if (ctx.bool('noEmit') === true || ctx.bool('emitDeclarationOnly') === true) return undefined;
      if (ctx.bool('rewriteRelativeImportExtensions') === true) return undefined;
      return hit(
        'error',
        'importing `.ts` paths is enabled in a project that emits JavaScript',
        'tsc rejects this combination (TS5096), because it would emit `import "./x.ts"` into a `.js` file that has no `.ts` next to it at runtime. The project does not build.',
        'Add `"noEmit": true` if another tool does the emit, or `"rewriteRelativeImportExtensions": true` to have tsc rewrite the specifiers, or drop the option and import extensionless or `.js` paths.',
      );
    },
  },
  {
    code: 'TSD028',
    option: 'resolveJsonModule',
    run(ctx) {
      if (ctx.bool('resolveJsonModule') !== true) return undefined;
      const resolution = ctx.text('moduleResolution');
      if (resolution !== 'classic') return undefined;
      return hit(
        'error',
        '`resolveJsonModule` is rejected under classic resolution',
        'tsc refuses this combination (TS5070), so the project does not compile: classic resolution has no concept of resolving a file by extension inside `node_modules`, so JSON imports could not be resolved anyway.',
        'Use `"moduleResolution": "bundler"`, `"node16"` or `"nodenext"`.',
      );
    },
  },
  {
    code: 'TSD029',
    option: 'paths',
    run(ctx) {
      const paths = ctx.get('paths');
      if (paths === undefined) return undefined;
      if (ctx.bool('noEmit') === true) {
        return hit(
          'info',
          'path aliases are a type-level fiction that the runtime does not share',
          'tsc never rewrites specifiers on emit, and this project does not emit anyway — so whatever runs the code must be taught the same aliases separately. When they drift, the compiler resolves `@app/db` to one file and the bundler to another, or to nothing.',
          'Keep the aliases in exactly one place and derive the rest: a bundler plugin that reads tsconfig, or Node `imports` subpath patterns in package.json, which both tsc and Node understand natively.',
        );
      }
      return hit(
        'warning',
        'path aliases survive into the emitted JavaScript unchanged, and fail at runtime',
        'This is the most common way a build that type-checks cleanly throws `ERR_MODULE_NOT_FOUND` on start-up: tsc resolves `@app/db` for type-checking and then emits `require("@app/db")` verbatim. Nothing at runtime knows what that means unless a loader, bundler or `paths`-aware runtime is configured with the same map.',
        'Prefer package.json `imports` (`#app/db`), which Node resolves natively and TypeScript understands. If you keep `paths`, make the runtime resolution part of the build and test the built output, not just the sources.',
      );
    },
  },

  // ------------------------------------------------------------------ target and emit
  {
    code: 'TSD040',
    option: 'target',
    run(ctx) {
      if (ctx.text('target') !== undefined) return undefined;
      return hit(
        'warning',
        'the target defaults to ES5, so modern syntax is rewritten and modern globals are missing',
        'An unset `target` means ES5. Every `async` function becomes a state machine, every class becomes a function with prototype assignments, and `lib` defaults to the ES5 library — so `Promise`, `Map`, `Object.entries` and `??=` are all either absent from the type system or downlevelled. Stack traces stop matching the source, and the output is many times larger than the input.',
        'Set `target` explicitly to the oldest runtime you truly support — `"es2022"` covers Node 18+ and every browser released since 2021.',
      );
    },
  },
  {
    code: 'TSD041',
    option: 'target',
    run(ctx) {
      if (ctx.text('target') === undefined) return undefined;
      if (!ctx.targetBelow('es2020')) return undefined;
      if (ctx.target === 'es3') return undefined; // reported as a deprecation instead
      // Only mention the rewrites this target actually performs; a warning that
      // describes ES5 emit on an ES2017 project teaches the reader to skim.
      const rewrites: string[] = [];
      if (ctx.targetBelow('es2015')) {
        rewrites.push(
          'classes become functions with prototype assignments, and `let`/`const` become `var` with renamed bindings, so a closure captured in a loop no longer sees a fresh binding unless the compiler inserts a helper',
        );
      }
      if (ctx.targetBelow('es2017')) {
        rewrites.push(
          'every `async` function is rewritten into a generator driven by an `__awaiter` helper, which changes stack traces and hides async frames from profilers',
        );
      }
      if (ctx.targetBelow('es2020')) {
        rewrites.push(
          'optional chaining and nullish coalescing become several statements with temporaries, so `a?.b?.c` no longer appears in the output at all',
        );
      }
      return hit(
        'warning',
        `\`target: "${ctx.target}"\` rewrites syntax, so the code that ships is not the code that was written`,
        `At this target ${rewrites.join('; and ')}. None of that is wrong, and all of it is invisible until you read the output or a stack trace from it — but it is only worth paying for if something you support really cannot run the original syntax.`,
        'Raise `target` to the oldest runtime you actually support, checked against your `engines` field or browserslist rather than left at a value copied from a template.',
      );
    },
  },
  {
    code: 'TSD042',
    option: 'target',
    run(ctx) {
      if (ctx.target !== 'es3') return undefined;
      return hit(
        'error',
        '`target: "es3"` was deprecated in TypeScript 5.0 and removed in 5.6',
        'TypeScript 5.0–5.5 reject it (TS5107) unless `"ignoreDeprecations": "5.0"` is set; from 5.6 it has been removed (TS5108) and `ignoreDeprecations` no longer helps. A project that still sets it stops building on a compiler upgrade rather than on a code change — which makes it look like the upgrade broke something.',
        'Move to `"es5"` at minimum. Nothing that runs JavaScript today needs ES3.',
      );
    },
  },
  {
    code: 'TSD043',
    option: 'useDefineForClassFields',
    run(ctx) {
      if (ctx.bool('useDefineForClassFields') !== undefined) return undefined;
      const implied = !ctx.targetBelow('es2022');
      return hit(
        'warning',
        `class field semantics are decided by \`target\` alone, and are currently ${implied ? 'define' : 'assignment'}`,
        `This option defaults to true when \`target\` is ES2022 or newer and false otherwise, so raising the target changes what class fields *do*. Under define semantics (the standard) a declared field runs \`Object.defineProperty\` and overwrites anything the base constructor set, shadows an inherited accessor instead of calling its setter, and initialises \`name: string\` to \`undefined\` even when a parameter property in the base assigned it. Your target is \`${ctx.target}\`, so today the behaviour is ${implied ? '**define**' : '**assignment**'} — and it will flip the moment somebody raises the target.`,
        'Set `useDefineForClassFields` explicitly so the semantics are a decision rather than a side effect. New code should say `true`; older code relying on setter interception should say `false` and carry a comment.',
      );
    },
  },
  {
    code: 'TSD044',
    option: 'outDir',
    run(ctx) {
      if (!ctx.emits) return undefined;
      if (ctx.value('outDir') !== undefined) return undefined;
      if (ctx.value('outFile') !== undefined) return undefined;
      return hit(
        'warning',
        'compiled JavaScript is written next to every source file',
        'With no `outDir`, `src/index.ts` emits `src/index.js`. Those files are then inside the default include pattern, so the next build sees them as inputs; if `allowJs` is ever enabled they are compiled, and if they are ever committed the wrong one gets imported. Cleaning the build means deleting files interleaved with sources.',
        'Set `"outDir": "dist"`, or `"noEmit": true` if another tool does the compiling.',
      );
    },
  },
  {
    code: 'TSD045',
    option: 'rootDir',
    run(ctx) {
      if (!ctx.emits) return undefined;
      if (ctx.value('outDir') === undefined) return undefined;
      if (ctx.value('rootDir') !== undefined) return undefined;
      return hit(
        'info',
        'the output directory layout changes whenever a file is added outside `src`',
        'Without `rootDir`, tsc infers it as the longest common directory of the input files. Add one import from a sibling package, or a root-level `vitest.config.ts`, and the common root moves up — so `dist/index.js` silently becomes `dist/src/index.js` and every `main`, `bin` and deep import in package.json points at nothing.',
        'Set `"rootDir": "src"`. tsc then reports an error when a file falls outside it, instead of quietly reshaping `dist`.',
      );
    },
  },
  {
    code: 'TSD046',
    option: 'declarationMap',
    run(ctx) {
      if (ctx.bool('declaration') !== true && ctx.bool('composite') !== true) return undefined;
      if (ctx.bool('declarationMap') === true) return undefined;
      return hit(
        'info',
        '"go to definition" lands in generated `.d.ts` files instead of the source',
        'Declaration files are emitted without maps, so every consumer inside the repo — and every editor — navigates into `dist/*.d.ts`. Reading is confusing and editing is worse: the change is made in a build artefact and is lost on the next compile.',
        'Set `"declarationMap": true` and ship the `.d.ts.map` files alongside your sources.',
      );
    },
  },
  {
    code: 'TSD047',
    option: 'sourceMap',
    run(ctx) {
      if (!ctx.emits) return undefined;
      if (ctx.bool('sourceMap') === true || ctx.bool('inlineSourceMap') === true) return undefined;
      return hit(
        'info',
        'production stack traces point at compiled output with no way back to the source',
        'Without source maps, a stack frame names a line in `dist` that may not correspond to any line you wrote, especially once `async` or class syntax has been downlevelled. Debuggers cannot set a breakpoint in a `.ts` file.',
        'Set `"sourceMap": true`. If you do not want maps on the wire, emit them and upload them to your error reporter rather than skipping them.',
      );
    },
  },
  {
    code: 'TSD048',
    option: 'incremental',
    run(ctx) {
      if (ctx.bool('incremental') !== true && ctx.bool('composite') !== true) return undefined;
      if (ctx.value('tsBuildInfoFile') !== undefined) return undefined;
      return hit(
        'info',
        'a `.tsbuildinfo` file appears in the tree at a location you did not choose',
        'tsc writes the build state next to `outDir` — or beside the config when there is no `outDir` — under a name derived from the config file. It is a cache: committing it makes builds non-deterministic across machines, and a stale one makes tsc skip files that really did change.',
        'Set `tsBuildInfoFile` to a path inside a build directory and add that directory to `.gitignore`.',
      );
    },
  },
  {
    code: 'TSD049',
    option: 'noEmitOnError',
    run(ctx) {
      if (!ctx.emits) return undefined;
      if (ctx.bool('noEmitOnError') === true) return undefined;
      return hit(
        'info',
        'JavaScript is written even when the type check fails',
        'tsc emits best-effort output for a program with errors and exits non-zero. A build script that ignores the exit code, or a watch task that keeps a server running, therefore publishes and runs code the compiler rejected.',
        'Set `"noEmitOnError": true` so a failed check leaves the previous output in place rather than replacing it with something known to be wrong.',
      );
    },
  },
  {
    code: 'TSD050',
    option: 'lib',
    run(ctx) {
      const lib = ctx.list('lib');
      if (lib === undefined) return undefined;
      const entries = lib.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase());
      const hasDom = entries.some((entry) => entry.startsWith('dom'));
      const detail = hasDom
        ? 'The list replaces the target defaults entirely.'
        : 'The list has no `dom` entry, so `document`, `fetch`, `console`, `setTimeout` and every other browser global are undeclared here.';
      return hit(
        'warning',
        'an explicit `lib` replaces the target defaults instead of adding to them',
        `\`lib\` is not additive: whatever you list is the complete set of ambient declarations, and the libraries implied by \`target\` are discarded. ${detail} Because raising \`target\` no longer brings new globals with it, the type system can end up describing an older runtime than the one the code is compiled for — and the missing methods exist at runtime, so the only symptom is a type error in the wrong place, or a polyfill added for no reason.`,
        'Drop `lib` and let `target` imply it, unless you genuinely need to add something (`["ES2022", "DOM", "DOM.Iterable"]`) — in which case list the target library explicitly alongside the additions and keep the two in step.',
      );
    },
  },
  {
    code: 'TSD051',
    option: 'jsx',
    run(ctx) {
      const jsx = ctx.text('jsx');
      if (jsx !== 'react') return undefined;
      return hit(
        'warning',
        '`jsx: "react"` emits `React.createElement`, so every file needs React in scope',
        'This is the pre-React-17 classic runtime. Each JSX file must import React even when it never mentions it, an unused-import lint rule will happily delete that import, and the resulting failure is a runtime "React is not defined" rather than a compile error. The automatic runtime has been available since TypeScript 4.1.',
        'Use `"jsx": "react-jsx"` (or `"react-jsxdev"` in development), which imports the factory from `react/jsx-runtime` for you. Set `jsxImportSource` if you use Preact or Emotion.',
      );
    },
  },
  {
    code: 'TSD052',
    option: 'experimentalDecorators',
    run(ctx) {
      if (ctx.bool('experimentalDecorators') !== true) return undefined;
      return hit(
        'warning',
        'decorators use the 2015 proposal, not the standard ones TypeScript 5 implements',
        'The two designs differ in evaluation order, in what the decorator receives, and in whether it can replace the class element. Any documentation, example or library written for standard decorators will misbehave here, usually by receiving `undefined` where it expected a context object. The flag remains necessary today for NestJS, TypeORM, Angular and anything else that depends on `emitDecoratorMetadata`, which the standard decorators do not support.',
        'Keep the flag if a framework requires it, and record why. For new code with no such dependency, remove it and use the standard decorators TypeScript 5.0 supports natively.',
      );
    },
  },
  {
    code: 'TSD053',
    option: 'emitDecoratorMetadata',
    run(ctx) {
      if (ctx.bool('emitDecoratorMetadata') !== true) return undefined;
      if (ctx.bool('experimentalDecorators') === true) return undefined;
      return hit(
        'error',
        '`emitDecoratorMetadata` is rejected without `experimentalDecorators`',
        'tsc refuses this combination (TS5052), so the project does not compile. The reason is that design-time type metadata only exists for the legacy decorator implementation: with standard decorators there is no `design:type` metadata to emit, and a dependency-injection container that resolves constructor parameters by type would find nothing.',
        'Set `"experimentalDecorators": true` alongside it, or drop `emitDecoratorMetadata` and register dependencies explicitly by token.',
      );
    },
  },
  {
    code: 'TSD054',
    option: 'downlevelIteration',
    run(ctx) {
      if (ctx.bool('downlevelIteration') === true) return undefined;
      if (!ctx.targetBelow('es2015')) return undefined;
      return hit(
        'warning',
        'spreading or iterating anything but an array silently produces the wrong result',
        `At target \`${ctx.target}\`, \`for...of\` and spread are compiled to an index loop instead of using the iteration protocol. On a \`Map\`, a \`Set\`, a generator or a DOM collection that loop reads \`.length\` — which does not exist — and iterates zero times. No error is reported at compile time or at runtime; the code just does nothing.`,
        'Set `"downlevelIteration": true`, or raise `target` to ES2015 or above, which is the better fix.',
      );
    },
  },

  // ----------------------------------------------------------- program inputs
  {
    code: 'TSD060',
    run(ctx) {
      if (ctx.topLevel('include') !== undefined || ctx.topLevel('files') !== undefined) return undefined;
      return hit(
        'warning',
        'the program is every `.ts` file under the config directory, whatever appears there later',
        'With neither `files` nor `include`, tsc includes `**/*` relative to the config. A scratch file, a copied vendor directory or a second package checked out inside the tree all become part of the build without anyone changing the config — slowing it down, and sometimes failing it on code nobody meant to compile.',
        'Add `"include": ["src"]` (plus `"test"` if the tests are type-checked by the same project).',
        'include',
      );
    },
  },
  {
    code: 'TSD061',
    option: 'types',
    run(ctx) {
      const types = ctx.list('types');
      if (types === undefined) return undefined;
      const names = types.filter((item): item is string => typeof item === 'string');
      return hit(
        'warning',
        names.length === 0
          ? '`"types": []` removes every global type package, including Node\'s'
          : `only ${names.length} \`@types\` package${names.length === 1 ? '' : 's'} contribute global declarations`,
        'By default tsc includes every package under `node_modules/@types` automatically. Listing `types` replaces that with exactly what you name, so anything omitted stops contributing globals — `process`, `Buffer` and `__dirname` vanish with `@types/node`, and a test runner\'s `describe`/`it` vanish with its own types package. Because these are globals rather than imports, the symptom is "cannot find name" in files that were not touched.',
        'The narrowing is worth having — it stops an unrelated dependency putting globals in your project. Just list every package you rely on, and add to the list rather than importing types you expected to be ambient.',
      );
    },
  },
  {
    code: 'TSD062',
    option: 'forceConsistentCasingInFileNames',
    run(ctx) {
      if (ctx.bool('forceConsistentCasingInFileNames') !== false) return undefined;
      return hit(
        'error',
        'imports that disagree about filename casing build on macOS and Windows and fail on Linux',
        'macOS and Windows file systems are case-insensitive, so `./Button` resolves to `button.tsx` locally. Linux is not, so the same import fails in CI and in a container — and the failure is a resolution error in a file nobody edited. The compiler defaults this to true precisely because the mistake is invisible on the machine where it is made.',
        'Remove the option, or set it to `true`, then fix the casing the compiler reports.',
      );
    },
  },
  {
    code: 'TSD063',
    run(ctx) {
      if (ctx.topLevel('exclude') === undefined) return undefined;
      if (ctx.topLevel('files') === undefined) return undefined;
      if (ctx.topLevel('include') !== undefined) return undefined;
      return hit(
        'info',
        '`exclude` has no effect on the files listed in `files`',
        '`exclude` only filters the results of `include`. Files named in `files` are always part of the program, so an entry here that is meant to keep something out of the build does nothing at all — and reads as though it does.',
        'Remove the `exclude`, or switch to `include` patterns that `exclude` can act on.',
        'exclude',
      );
    },
  },
  {
    code: 'TSD064',
    run(ctx) {
      const exclude = ctx.topLevel('exclude');
      if (exclude === undefined) return undefined;
      const outDir = ctx.text('outDir');
      if (outDir === undefined) return undefined;
      const patterns = Array.isArray(exclude.value)
        ? exclude.value.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase())
        : [];
      const cleaned = outDir.replace(/^\.\//, '').replace(/\/+$/, '');
      const covered = patterns.some((pattern) => pattern.replace(/^\.\//, '').replace(/[/*]+$/, '') === cleaned);
      if (covered) return undefined;
      return hit(
        'warning',
        `writing an explicit \`exclude\` stopped \`${outDir}\` from being excluded automatically`,
        'The default `exclude` is `["node_modules", "bower_components", "jspm_packages"]` **plus the value of `outDir`**. Supplying your own list replaces all of it, so the compiler now treats its own output as input: declaration files in `dist` shadow the sources they were generated from, and each build can pick up the previous build.',
        `Add \`"${cleaned}"\` to \`exclude\` (and keep \`"node_modules"\` there too).`,
        'exclude',
      );
    },
  },
  {
    code: 'TSD065',
    option: 'typeRoots',
    run(ctx) {
      if (ctx.value('typeRoots') === undefined) return undefined;
      return hit(
        'info',
        'automatic `@types` discovery no longer walks up to parent directories',
        'By default tsc looks in `node_modules/@types` in every ancestor directory, which is what makes hoisted types work in a monorepo. Setting `typeRoots` replaces that search with exactly the directories you list, so types installed at the workspace root are invisible to a package that sets it.',
        'Only set `typeRoots` when you have custom declaration directories, and include `"./node_modules/@types"` in the list when you do.',
      );
    },
  },

  // ------------------------------------------------------ structure and deprecations
  {
    code: 'TSD080',
    run(ctx) {
      if (ctx.config.references.length === 0) return undefined;
      if (ctx.bool('composite') === true) return undefined;
      return hit(
        'info',
        'project references are declared, but only `tsc -b` honours them',
        `This project references ${ctx.config.references.length} other project${ctx.config.references.length === 1 ? '' : 's'}. A plain \`tsc -p\` — which is what most editors, test runners and IDE plugins run — ignores \`references\` entirely and type-checks the imported sources directly, under *this* project's options rather than their own. A dependency that is deliberately looser therefore passes locally and fails under \`tsc -b\` in CI, or the reverse.`,
        'Build with `tsc -b` everywhere, including in the typecheck script, so one set of semantics applies. Add `"composite": true` here as well if anything references this project.',
        'composite',
      );
    },
  },
  {
    code: 'TSD081',
    option: 'declaration',
    run(ctx) {
      if (ctx.bool('composite') !== true) return undefined;
      if (ctx.bool('declaration') !== false) return undefined;
      return hit(
        'error',
        '`composite` requires declarations, so `"declaration": false` is rejected',
        'A composite project is consumed by other projects through its `.d.ts` output; that is what allows tsc to build it once instead of re-reading its sources. tsc reports TS6304 and refuses to build.',
        'Remove `"declaration": false`, or remove `composite` if this project is not referenced by another.',
      );
    },
  },
  {
    code: 'TSD082',
    run(ctx) {
      const hits: RuleHit[] = [];
      const ignoring = ctx.value('ignoreDeprecations') !== undefined;
      for (const [option, why] of DEPRECATED_OPTIONS) {
        if (ctx.get(option) === undefined) continue;
        hits.push(
          hit(
            'error',
            `\`${option}\` was deprecated in TypeScript 5.0 and removed in 5.6`,
            `${why[0]?.toUpperCase()}${why.slice(1)}. TypeScript 5.0–5.5 reject the option (TS5101) unless \`"ignoreDeprecations": "5.0"\` is set; from 5.6 it has been removed (TS5102) and \`ignoreDeprecations\` no longer silences it${ignoring ? ' — so the `ignoreDeprecations` in this config only helps on 5.5 and older' : ''}. A compiler upgrade breaks the build with no source change to blame.`,
            `Remove \`${option}\` and adopt its replacement before upgrading.`,
            option,
          ),
        );
      }
      return hits;
    },
  },
  {
    code: 'TSD083',
    run(ctx) {
      const hits: RuleHit[] = [];
      for (const [name] of ctx.config.options) {
        if (KNOWN_OPTIONS.has(name)) continue;
        hits.push(
          hit(
            'warning',
            `\`${name}\` is not a compiler option and has no effect`,
            'tsc reports unknown options when it reads the config from the command line, but plenty of tools read tsconfig.json leniently and say nothing. Either way the setting does nothing — and the behaviour it was added to obtain is whatever the default is.',
            `Check the spelling against the compiler option reference, and confirm the intended setting is actually taking effect. If \`${name}\` belongs to another tool, move it to that tool's own config.`,
            name,
          ),
        );
      }
      return hits;
    },
  },
  {
    code: 'TSD084',
    run(ctx) {
      const relativeOptions = ['outDir', 'rootDir', 'baseUrl', 'declarationDir', 'tsBuildInfoFile', 'outFile'];
      const hits: RuleHit[] = [];
      for (const name of relativeOptions) {
        const record = ctx.get(name);
        if (record === undefined) continue;
        if (record.file === ctx.config.fileName) continue;
        const value = record.value;
        if (typeof value !== 'string') continue;
        if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) continue;
        hits.push(
          hit(
            'warning',
            `\`${name}\` is inherited, so it points relative to the base config, not to this one`,
            `The value \`${value}\` was written in \`${record.file}\`, and relative paths in an inherited option keep the meaning they had in the file that declared them. It therefore resolves against that file's directory — not this project's — which is almost never what a package inheriting a shared base intends, and produces output in a directory nobody is looking at.`,
            `Override \`${name}\` in this config with a path relative to it, or express the base value with the \`\${configDir}\` template variable (TypeScript 5.5+) so it re-resolves per package.`,
            name,
          ),
        );
      }
      return hits;
    },
  },
  {
    code: 'TSD085',
    option: 'strict',
    run(ctx) {
      const record = ctx.get('strict');
      if (record === undefined || record.value !== false) return undefined;
      if (record.overridden.length === 0) return undefined;
      return hit(
        'error',
        'this config turns `strict` off again after inheriting it',
        `\`strict\` is set here, overriding the value from ${record.overridden.join(', ')}. Because \`compilerOptions\` merge key by key with the child winning, one line undoes the whole strict family for this project while the base config continues to advertise it — so the repository looks uniformly strict and is not.`,
        'Remove the override, or narrow it to the specific flags that are genuinely blocked, so the remaining gap is one line rather than eight.',
      );
    },
  },
];
