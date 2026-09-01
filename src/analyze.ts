/**
 * Running the rules over a resolved config.
 *
 * This module is pure: it takes a {@link ResolvedConfig} and returns findings.
 * Nothing here reads a file or writes to a stream, which is what lets the whole
 * rule set be exercised against fixture configs held in memory.
 */

import { RULES, RuleContext, type Rule, type RuleHit } from './rules.js';
import { SEVERITY_RANK, type Finding, type ResolvedConfig, type Severity } from './types.js';

/** Filters applied after every rule has run. */
export interface AnalyzeOptions {
  /** Codes to drop, e.g. `['TSD017']`. Case-insensitive. */
  readonly ignore?: readonly string[] | undefined;
  /** If present, keep only these codes. Case-insensitive. */
  readonly only?: readonly string[] | undefined;
  /** Drop findings below this severity. Defaults to `info`. */
  readonly minSeverity?: Severity | undefined;
  /** The rules to run. Defaults to every built-in rule. */
  readonly rules?: readonly Rule[] | undefined;
}

/** Counts by severity, for summaries and exit codes. */
export interface Summary {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
  readonly total: number;
}

function toFinding(config: ResolvedConfig, rule: Rule, result: RuleHit): Finding {
  const optionName = result.option ?? rule.option;
  const record =
    optionName === undefined
      ? undefined
      : (config.options.get(optionName) ?? config.topLevel.get(optionName));
  return {
    code: rule.code,
    severity: result.severity,
    title: result.title,
    option: optionName,
    file: record?.file ?? config.fileName,
    loc: record?.loc,
    consequence: result.consequence,
    fix: result.fix,
  };
}

function normalizeCodes(codes: readonly string[] | undefined): Set<string> | undefined {
  if (codes === undefined) return undefined;
  return new Set(codes.map((code) => code.trim().toUpperCase()).filter((code) => code !== ''));
}

/**
 * Diagnoses a config.
 *
 * Findings from loading (missing files, syntax errors, dangling references) are
 * returned alongside rule findings and obey the same filters, so a caller never
 * has to handle two kinds of problem differently.
 */
export function analyze(config: ResolvedConfig, options: AnalyzeOptions = {}): Finding[] {
  const rules = options.rules ?? RULES;
  const ctx = new RuleContext(config);
  const findings: Finding[] = [...config.problems];

  for (const rule of rules) {
    const result = rule.run(ctx);
    if (result === undefined) continue;
    for (const single of Array.isArray(result) ? result : [result]) {
      findings.push(toFinding(config, rule, single));
    }
  }

  const ignore = normalizeCodes(options.ignore);
  const only = normalizeCodes(options.only);
  const floor = SEVERITY_RANK[options.minSeverity ?? 'info'];

  const kept = findings.filter((finding) => {
    if (SEVERITY_RANK[finding.severity] < floor) return false;
    if (ignore?.has(finding.code) === true) return false;
    if (only !== undefined && !only.has(finding.code)) return false;
    return true;
  });

  // Loudest first, then by code so output is stable enough to diff between runs.
  kept.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return (a.option ?? '') < (b.option ?? '') ? -1 : 1;
  });

  return kept;
}

/** Counts findings by severity. */
export function summarize(findings: readonly Finding[]): Summary {
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const finding of findings) {
    if (finding.severity === 'error') error += 1;
    else if (finding.severity === 'warning') warning += 1;
    else info += 1;
  }
  return { error, warning, info, total: findings.length };
}
