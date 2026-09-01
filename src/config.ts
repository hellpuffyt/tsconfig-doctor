/**
 * Reading a tsconfig the way TypeScript reads it.
 *
 * The rules operate on a {@link ResolvedConfig}, never on a file, because most
 * of the interesting mistakes are only visible after inheritance: a base config
 * three packages away turns `strict` off, or a `paths` map is inherited into a
 * package where its relative roots no longer point anywhere. Resolving that
 * chain faithfully is most of the work, and it has a few rules that surprise
 * people:
 *
 * - `compilerOptions` merge key by key, child wins. Values are **replaced, not
 *   merged** — an inherited `paths` or `lib` array is discarded whole the
 *   moment the child mentions it.
 * - `files`, `include` and `exclude` are inherited, and likewise replaced.
 * - `references` are **not** inherited at all.
 * - Relative paths keep the meaning they had in the file that wrote them. An
 *   `outDir: "./dist"` inherited from `../../base.json` still points at
 *   `../../dist`. Every option therefore remembers which file declared it.
 *
 * File access goes through {@link Host} so the whole loader can be driven from
 * an in-memory map in tests, with no temporary directories and no platform
 * differences.
 */

import {
  getMember,
  parseJsonc,
  type JsonValue,
  type Loc,
  type ObjectNode,
  type JsonNode,
} from './jsonc.js';
import {
  dirname,
  hasJsonExtension,
  isAbsolutePath,
  joinPath,
  resolvePath,
  toPosix,
} from './paths.js';
import type { Finding, OptionRecord, ProjectReference, ResolvedConfig } from './types.js';

/** The only file-system capability the loader needs. */
export interface Host {
  /** Returns the file's text, or `undefined` if it does not exist. */
  readFile(path: string): string | undefined;
}

/** A {@link Host} backed by a plain object, for tests and for embedding. */
export function createMemoryHost(files: Readonly<Record<string, string>>): Host {
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(files)) normalized.set(toPosix(key), value);
  return {
    readFile(path: string): string | undefined {
      return normalized.get(toPosix(path));
    },
  };
}

interface Layer {
  readonly options: Map<string, OptionRecord>;
  readonly topLevel: Map<string, OptionRecord>;
  readonly chain: string[];
  readonly problems: Finding[];
  readonly node: ObjectNode | undefined;
}

function emptyLayer(): Layer {
  return { options: new Map(), topLevel: new Map(), chain: [], problems: [], node: undefined };
}

function problem(
  code: string,
  file: string,
  title: string,
  consequence: string,
  fix: string,
  loc?: Loc,
): Finding {
  return { code, severity: 'error', title, file, loc, consequence, fix };
}

/** Overlays `child` onto `parent`, recording who lost so rules can explain it. */
function overlay(parent: Map<string, OptionRecord>, child: Map<string, OptionRecord>): void {
  for (const [name, record] of child) {
    const existing = parent.get(name);
    parent.set(
      name,
      existing === undefined
        ? record
        : { ...record, overridden: [...existing.overridden, existing.file] },
    );
  }
}

function readObjectMembers(node: ObjectNode, file: string): Map<string, OptionRecord> {
  const out = new Map<string, OptionRecord>();
  for (const member of node.members) {
    out.set(member.key, {
      name: member.key,
      value: plain(member.value),
      file,
      loc: member.keyLoc,
      overridden: [],
    });
  }
  return out;
}

function plain(node: JsonNode): JsonValue {
  if (node.kind === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const member of node.members) out[member.key] = plain(member.value);
    return out;
  }
  if (node.kind === 'array') return node.items.map(plain);
  return node.value;
}

/**
 * Resolves an `extends` specifier.
 *
 * Relative and absolute specifiers resolve against the containing file, with a
 * `.json` extension appended if the literal path is not there. Anything else is
 * a package name, looked up in `node_modules` walking upwards — which is how
 * `"extends": "@tsconfig/node20/tsconfig.json"` works.
 */
export function resolveExtends(spec: string, fromFile: string, host: Host): string | undefined {
  const base = dirname(fromFile);
  if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..' || isAbsolutePath(spec)) {
    const direct = resolvePath(base, spec);
    if (host.readFile(direct) !== undefined) return direct;
    if (!hasJsonExtension(direct)) {
      const withExtension = `${direct}.json`;
      if (host.readFile(withExtension) !== undefined) return withExtension;
      const inside = joinPath(direct, 'tsconfig.json');
      if (host.readFile(inside) !== undefined) return inside;
    }
    return undefined;
  }

  let directory = base;
  for (;;) {
    const packageRoot = joinPath(directory, 'node_modules', spec);
    const candidates = [packageRoot, `${packageRoot}.json`, joinPath(packageRoot, 'tsconfig.json')];
    for (const candidate of candidates) {
      if (host.readFile(candidate) !== undefined) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function readLayer(file: string, host: Host, stack: readonly string[]): Layer {
  const text = host.readFile(file);
  if (text === undefined) {
    const layer = emptyLayer();
    layer.problems.push(
      problem(
        'TSD900',
        file,
        'the config file does not exist, so nothing was analysed',
        'Every path below is resolved against this file. With the file missing there is no baseline to compare against, and `tsc -p` would fail the same way.',
        'Check the path, or run the tool from the directory that holds the tsconfig.',
      ),
    );
    return layer;
  }

  const { root, diagnostics } = parseJsonc(text);
  const problems: Finding[] = [];
  for (const diagnostic of diagnostics) {
    problems.push({
      code: 'TSD901',
      severity: diagnostic.severity === 'warning' ? 'warning' : 'error',
      title: `the config does not parse cleanly: ${diagnostic.message}`,
      file,
      loc: { start: diagnostic.position, end: diagnostic.position },
      consequence:
        'tsc reads tsconfig.json with a JSON-with-comments scanner. Anything it cannot scan is either rejected outright or silently skipped, which means options you believe are set may never reach the compiler.',
      fix: 'Fix the syntax at the reported line. Comments and trailing commas are allowed; single quotes and unquoted keys are not.',
    });
  }

  if (root === undefined || root.kind !== 'object') {
    problems.push(
      problem(
        'TSD902',
        file,
        'the top level of the config is not an object, so every setting is ignored',
        'tsc expects a JSON object at the root. A file whose root is an array, a string or nothing at all contributes no options, and the compiler falls back to its defaults for every single one.',
        'Wrap the settings in `{ "compilerOptions": { ... } }`.',
        root?.loc,
      ),
    );
    return { ...emptyLayer(), problems, chain: [file] };
  }

  const layer: Layer = {
    options: new Map(),
    topLevel: new Map(),
    chain: [],
    problems,
    node: root,
  };

  // --- extends -------------------------------------------------------------
  const extendsMember = getMember(root, 'extends');
  if (extendsMember !== undefined) {
    const specs: { spec: string; loc: Loc }[] = [];
    const value = extendsMember.value;
    if (value.kind === 'string') {
      specs.push({ spec: value.value, loc: value.loc });
    } else if (value.kind === 'array') {
      for (const item of value.items) {
        if (item.kind === 'string') {
          specs.push({ spec: item.value, loc: item.loc });
        } else {
          problems.push(
            problem(
              'TSD906',
              file,
              'an `extends` entry is not a string and is ignored',
              'Only strings name a config to inherit from. A non-string entry contributes nothing, so the options you expected to inherit are simply absent and the compiler uses its defaults instead.',
              'Make every element of the `extends` array a path or package name.',
              item.loc,
            ),
          );
        }
      }
    } else {
      problems.push(
        problem(
          'TSD906',
          file,
          '`extends` is neither a string nor an array, so nothing is inherited',
          'The whole base config is skipped. Options you assume are inherited fall back to compiler defaults, which for the strict family means "off".',
          'Set `extends` to a path such as `"./tsconfig.base.json"`, or to an array of them.',
          value.loc,
        ),
      );
    }

    for (const { spec, loc } of specs) {
      const resolved = resolveExtends(spec, file, host);
      if (resolved === undefined) {
        problems.push(
          problem(
            'TSD904',
            file,
            `the base config \`${spec}\` cannot be found, so none of its options apply`,
            'tsc reports this as an error, but editors and tools that read the config leniently do not: they carry on with whatever was left, which is usually a much weaker configuration than intended.',
            'Check the path, or install the package that provides it.',
            loc,
          ),
        );
        continue;
      }
      if (stack.includes(resolved)) {
        problems.push(
          problem(
            'TSD905',
            file,
            `the \`extends\` chain is circular: \`${spec}\` is already being resolved`,
            'A cycle cannot be merged. Resolution stops here, and every option that the rest of the cycle would have contributed is missing.',
            'Break the cycle by pointing one of the configs at a shared base instead of at each other.',
            loc,
          ),
        );
        continue;
      }
      const parent = readLayer(resolved, host, [...stack, resolved]);
      layer.problems.push(...parent.problems);
      for (const entry of parent.chain) {
        if (!layer.chain.includes(entry)) layer.chain.push(entry);
      }
      overlay(layer.options, parent.options);
      overlay(layer.topLevel, parent.topLevel);
    }
  }
  layer.chain.push(file);

  // --- own options ---------------------------------------------------------
  const compilerOptions = getMember(root, 'compilerOptions');
  if (compilerOptions !== undefined) {
    if (compilerOptions.value.kind === 'object') {
      overlay(layer.options, readObjectMembers(compilerOptions.value, file));
    } else {
      problems.push(
        problem(
          'TSD903',
          file,
          '`compilerOptions` is not an object, so every compiler option here is ignored',
          'tsc reads no options from a `compilerOptions` that is not an object. The build then runs on defaults — no strict checking, ES5 target, CommonJS interop off — while the file on disk suggests otherwise.',
          'Make `compilerOptions` a JSON object.',
          compilerOptions.value.loc,
        ),
      );
    }
  }

  const own = new Map<string, OptionRecord>();
  for (const member of root.members) {
    if (member.key === 'compilerOptions' || member.key === 'extends' || member.key === 'references') {
      continue;
    }
    own.set(member.key, {
      name: member.key,
      value: plain(member.value),
      file,
      loc: member.keyLoc,
      overridden: [],
    });
  }
  overlay(layer.topLevel, own);

  return layer;
}

function readReferences(
  layer: Layer,
  file: string,
  host: Host,
  followed: Set<string>,
): ProjectReference[] {
  const out: ProjectReference[] = [];
  const node = layer.node;
  if (node === undefined) return out;
  const member = getMember(node, 'references');
  if (member === undefined) return out;

  if (member.value.kind !== 'array') {
    layer.problems.push(
      problem(
        'TSD909',
        file,
        '`references` is not an array, so no project references are registered',
        'tsc silently treats a malformed `references` as absent. `tsc -b` then has nothing to build in order, and imports that cross project boundaries are re-checked from source under *this* project\'s options rather than their own.',
        'Make `references` an array of `{ "path": "..." }` objects.',
        member.value.loc,
      ),
    );
    return out;
  }

  const base = dirname(file);
  for (const item of member.value.items) {
    if (item.kind !== 'object') {
      layer.problems.push(
        problem(
          'TSD909',
          file,
          'a `references` entry is not an object and is ignored',
          'Each entry must be an object with a `path`. An entry of any other shape contributes no edge to the build graph, so `tsc -b` will not build that project first.',
          'Write the entry as `{ "path": "../other" }`.',
          item.loc,
        ),
      );
      continue;
    }
    const pathMember = getMember(item, 'path');
    if (pathMember === undefined || pathMember.value.kind !== 'string') {
      layer.problems.push(
        problem(
          'TSD909',
          file,
          'a `references` entry has no string `path` and is ignored',
          '`path` is the only required key of a reference. Without it the entry names no project, and the build order it was meant to express does not exist.',
          'Add `"path": "../other"` to the entry.',
          item.loc,
        ),
      );
      continue;
    }

    const raw = pathMember.value.value;
    const direct = resolvePath(base, raw);
    let resolved: string | undefined;
    for (const candidate of [direct, joinPath(direct, 'tsconfig.json'), `${direct}.json`]) {
      if (host.readFile(candidate) !== undefined) {
        resolved = candidate;
        break;
      }
    }

    let composite: boolean | undefined;
    if (resolved !== undefined && !followed.has(resolved)) {
      followed.add(resolved);
      const target = readLayer(resolved, host, [resolved]);
      const value = target.options.get('composite')?.value;
      composite = value === true;
    }
    out.push({ rawPath: raw, resolved, composite, loc: item.loc });
  }
  return out;
}

/**
 * Loads a tsconfig and everything it inherits from.
 *
 * Never throws: a missing file, unparseable text or circular `extends` all come
 * back as findings on the result, so a caller can report them exactly like any
 * other diagnosis.
 */
export function loadConfig(entryPath: string, host: Host, cwd = '/'): ResolvedConfig {
  const entry = toPosix(entryPath);
  const fileName = isAbsolutePath(entry) ? entry : resolvePath(toPosix(cwd), entry);
  const layer = readLayer(fileName, host, [fileName]);
  const references = readReferences(layer, fileName, host, new Set([fileName]));

  for (const reference of references) {
    if (reference.resolved === undefined) {
      layer.problems.push(
        problem(
          'TSD907',
          fileName,
          `the referenced project \`${reference.rawPath}\` does not exist`,
          '`tsc -b` fails outright on a dangling reference. A plain `tsc -p`, which is what most editors and test runners use, ignores `references` entirely and compiles the imported sources directly — so the error only appears in CI.',
          'Correct the path, or drop the reference.',
          reference.loc,
        ),
      );
    } else if (reference.composite === false) {
      layer.problems.push(
        problem(
          'TSD908',
          fileName,
          `the referenced project \`${reference.rawPath}\` does not set \`composite: true\``,
          'A referenced project must be composite; that is what makes tsc build it from its own declaration output instead of re-reading its sources. Without it `tsc -b` errors, and every other tool silently type-checks that project\'s files under *this* project\'s options.',
          'Add `"composite": true` to the referenced project, which also forces `declaration: true` there.',
          reference.loc,
        ),
      );
    }
  }

  return {
    fileName,
    options: layer.options,
    topLevel: layer.topLevel,
    chain: layer.chain.length > 0 ? layer.chain : [fileName],
    references,
    problems: layer.problems,
  };
}

/** A {@link Host} that reads the real file system. */
export function createNodeHost(readFileSync: (path: string) => string): Host {
  return {
    readFile(path: string): string | undefined {
      try {
        return readFileSync(path);
      } catch {
        return undefined;
      }
    },
  };
}
