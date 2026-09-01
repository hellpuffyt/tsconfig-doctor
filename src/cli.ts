/**
 * The command line.
 *
 * {@link run} takes its argv, its file system and its output streams as
 * arguments and returns an exit code rather than calling `process.exit`, so the
 * entire CLI — including argument errors and exit codes — is tested in memory
 * with no child processes and no temporary directories. `src/bin.ts` is the
 * only file that knows `process` exists.
 */

import { analyze, summarize } from './analyze.js';
import { createNodeHost, loadConfig, type Host } from './config.js';
import { formatJson, formatText } from './report.js';
import { RULES } from './rules.js';
import { hasJsonExtension, isAbsolutePath, joinPath, resolvePath, toPosix } from './paths.js';
import { SEVERITY_RANK, type Severity } from './types.js';
import { VERSION } from './version.js';

/** Everything the CLI needs from the outside world. */
export interface Io {
  readonly host: Host;
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** Builds an {@link Io} over the real process. */
export function nodeIo(
  readFileSync: (path: string) => string,
  cwd: string,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
): Io {
  return { host: createNodeHost(readFileSync), cwd: toPosix(cwd), out: stdout, err: stderr };
}

const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

export const HELP = `tsconfig-doctor ${VERSION}

Diagnose tsconfig settings that silently change behaviour, and explain the
consequence of each rather than the setting.

usage:
  tsconfig-doctor [path] [options]

  path                     a tsconfig.json, or a directory containing one.
                           Defaults to ./tsconfig.json.

options:
  --json                   emit machine-readable JSON instead of prose
  --min-severity LEVEL     hide findings below LEVEL (error|warning|info)
                           default: info
  --fail-on LEVEL          exit 1 when a finding of LEVEL or above is reported
                           (error|warning|info|never)  default: error
  --ignore CODES           comma-separated codes to suppress, e.g. TSD017,TSD047
  --only CODES             comma-separated codes to report exclusively
  --width N                wrap prose at N columns (default 80)
  --list-rules             print every rule code and the option it inspects
  -h, --help               show this message
  -V, --version            print the version

exit codes:
  0  no finding at or above --fail-on
  1  at least one such finding
  2  the arguments could not be understood
`;

interface ParsedArgs {
  readonly path?: string | undefined;
  readonly json: boolean;
  readonly minSeverity: Severity;
  readonly failOn: Severity | 'never';
  readonly ignore: string[];
  readonly only?: string[] | undefined;
  readonly width: number;
  readonly help: boolean;
  readonly version: boolean;
  readonly listRules: boolean;
}

class UsageError extends Error {}

function parseSeverity(flag: string, raw: string | undefined): Severity {
  if (raw === undefined) throw new UsageError(`${flag} needs a value`);
  const value = raw.toLowerCase();
  if (!SEVERITIES.includes(value as Severity)) {
    throw new UsageError(`${flag} must be one of error, warning, info (got ${JSON.stringify(raw)})`);
  }
  return value as Severity;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let path: string | undefined;
  let json = false;
  let minSeverity: Severity = 'info';
  let failOn: Severity | 'never' = 'error';
  let ignore: string[] = [];
  let only: string[] | undefined;
  let width = 80;
  let help = false;
  let version = false;
  let listRules = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    const next = (): string | undefined => argv[++index];
    switch (arg) {
      case '--json':
        json = true;
        break;
      case '--min-severity':
        minSeverity = parseSeverity('--min-severity', next());
        break;
      case '--fail-on': {
        const raw = next();
        failOn = raw?.toLowerCase() === 'never' ? 'never' : parseSeverity('--fail-on', raw);
        break;
      }
      case '--ignore': {
        const raw = next();
        if (raw === undefined) throw new UsageError('--ignore needs a value');
        ignore = raw.split(',');
        break;
      }
      case '--only': {
        const raw = next();
        if (raw === undefined) throw new UsageError('--only needs a value');
        only = raw.split(',');
        break;
      }
      case '--width': {
        const raw = next();
        const parsed = Number(raw);
        if (raw === undefined || !Number.isInteger(parsed) || parsed < 40) {
          throw new UsageError(`--width must be an integer of at least 40 (got ${String(raw)})`);
        }
        width = parsed;
        break;
      }
      case '--list-rules':
        listRules = true;
        break;
      case '-h':
      case '--help':
        help = true;
        break;
      case '-V':
      case '--version':
        version = true;
        break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`unknown option ${JSON.stringify(arg)}`);
        if (path !== undefined) throw new UsageError('only one path may be given');
        path = arg;
    }
  }

  return { path, json, minSeverity, failOn, ignore, only, width, help, version, listRules };
}

/**
 * Turns the positional argument into a config path.
 *
 * A directory is the common case (`tsconfig-doctor packages/api`), and so is a
 * bare `tsconfig.build.json`, so the two are distinguished by extension and by
 * what actually exists rather than by a flag.
 */
export function resolveConfigPath(input: string | undefined, cwd: string, host: Host): string {
  const base = toPosix(cwd);
  const raw = toPosix(input ?? 'tsconfig.json');
  const absolute = isAbsolutePath(raw) ? raw : resolvePath(base, raw);
  if (hasJsonExtension(absolute)) return absolute;
  const inside = joinPath(absolute, 'tsconfig.json');
  if (host.readFile(inside) !== undefined) return inside;
  if (host.readFile(absolute) !== undefined) return absolute;
  return inside;
}

/**
 * Runs the tool. Returns the process exit code and never throws for ordinary
 * input problems — those are reported on `err` and turned into code 2.
 */
export function run(argv: readonly string[], io: Io): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err(`tsconfig-doctor: ${error.message}\n`);
    io.err('run `tsconfig-doctor --help` for usage\n');
    return 2;
  }

  if (args.help) {
    io.out(HELP);
    return 0;
  }
  if (args.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  if (args.listRules) {
    for (const rule of RULES) {
      io.out(`${rule.code}\t${rule.option ?? '-'}\n`);
    }
    return 0;
  }

  const configPath = resolveConfigPath(args.path, io.cwd, io.host);
  const config = loadConfig(configPath, io.host, io.cwd);
  const findings = analyze(config, {
    ignore: args.ignore,
    only: args.only,
    minSeverity: args.minSeverity,
  });

  const report = args.json
    ? formatJson(findings, { file: config.fileName, chain: config.chain })
    : formatText(findings, {
        file: config.fileName,
        chain: config.chain,
        cwd: io.cwd,
        width: args.width,
      });
  io.out(report);

  if (args.failOn === 'never') return 0;
  const summary = summarize(findings);
  const counts: Record<Severity, number> = {
    error: summary.error,
    warning: summary.warning,
    info: summary.info,
  };
  const threshold = SEVERITY_RANK[args.failOn];
  const tripped = SEVERITIES.some(
    (severity) => SEVERITY_RANK[severity] >= threshold && counts[severity] > 0,
  );
  return tripped ? 1 : 0;
}
