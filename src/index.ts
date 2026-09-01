/**
 * tsconfig-doctor as a library.
 *
 * The pieces are exported separately because they are useful separately: the
 * JSONC parser for anything that has to read a tsconfig faithfully, the loader
 * for anything that has to resolve an `extends` chain, and {@link analyze} for
 * the diagnosis itself. Nothing exported from here touches the file system
 * except through a {@link Host} you supply.
 *
 * ```ts
 * import { analyze, createMemoryHost, loadConfig } from 'tsconfig-doctor';
 *
 * const host = createMemoryHost({
 *   '/p/tsconfig.json': '{ "compilerOptions": { "strict": true } }',
 * });
 * const findings = analyze(loadConfig('/p/tsconfig.json', host));
 * ```
 */

export { analyze, summarize, type AnalyzeOptions, type Summary } from './analyze.js';
export {
  createMemoryHost,
  createNodeHost,
  loadConfig,
  resolveExtends,
  type Host,
} from './config.js';
export {
  getMember,
  parseJsonc,
  parseJsoncValue,
  toPlain,
  type ArrayNode,
  type BooleanNode,
  type JsonMember,
  type JsonNode,
  type JsonObject,
  type JsoncDiagnostic,
  type JsoncSeverity,
  type JsonValue,
  type Loc,
  type NullNode,
  type NumberNode,
  type ObjectNode,
  type ParseResult,
  type Position,
  type StringNode,
} from './jsonc.js';
export {
  basename,
  dirname,
  hasJsonExtension,
  isAbsolutePath,
  joinPath,
  normalizePath,
  relativePath,
  resolvePath,
  toPosix,
} from './paths.js';
export { formatJson, formatText, summaryLine, wrap, type ReportOptions } from './report.js';
export {
  DEPRECATED_OPTIONS,
  KNOWN_OPTIONS,
  RULES,
  RuleContext,
  STRICT_FAMILY,
  type Rule,
  type RuleHit,
} from './rules.js';
export {
  SEVERITY_RANK,
  type Finding,
  type OptionRecord,
  type ProjectReference,
  type ResolvedConfig,
  type Severity,
} from './types.js';
export { HELP, nodeIo, resolveConfigPath, run, type Io } from './cli.js';
export { VERSION } from './version.js';
