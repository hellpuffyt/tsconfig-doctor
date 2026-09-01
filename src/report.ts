/**
 * Rendering findings.
 *
 * Two formats, both deterministic: the same config always produces byte-identical
 * output, so the CLI can be asserted against in CI (this repository's own
 * `dogfood` job does exactly that) and diffed between commits.
 */

import { summarize, type Summary } from './analyze.js';
import { relativePath } from './paths.js';
import type { Finding, Severity } from './types.js';

/** Knobs the reporters share. */
export interface ReportOptions {
  /** Paths are printed relative to this directory when that is shorter. */
  readonly cwd?: string | undefined;
  /** Wrap width for prose. Defaults to 80. */
  readonly width?: number | undefined;
  /** The `extends` chain, printed as a header when it has more than one entry. */
  readonly chain?: readonly string[] | undefined;
  /** The file that was analysed. */
  readonly file?: string | undefined;
}

const LABEL: Readonly<Record<Severity, string>> = {
  error: 'error  ',
  warning: 'warning',
  info: 'note   ',
};

/** Greedy word wrap. Long unbreakable tokens (paths, URLs) overflow rather than break. */
export function wrap(text: string, width: number, indent: string): string[] {
  const words = text.split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = indent;
  let empty = true;
  for (const word of words) {
    if (!empty && line.length + 1 + word.length > width) {
      lines.push(line);
      line = indent + word;
    } else {
      line = empty ? indent + word : `${line} ${word}`;
      empty = false;
    }
  }
  lines.push(line);
  return lines;
}

function display(path: string, cwd: string | undefined): string {
  if (cwd === undefined) return path;
  const relative = relativePath(cwd, path);
  return relative.length < path.length ? relative : path;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** A one-line tally, e.g. `2 errors, 1 warning, 3 notes`. */
export function summaryLine(summary: Summary): string {
  if (summary.total === 0) return 'no findings';
  const parts: string[] = [];
  if (summary.error > 0) parts.push(plural(summary.error, 'error', 'errors'));
  if (summary.warning > 0) parts.push(plural(summary.warning, 'warning', 'warnings'));
  if (summary.info > 0) parts.push(plural(summary.info, 'note', 'notes'));
  return parts.join(', ');
}

/** The human-readable report. */
export function formatText(findings: readonly Finding[], options: ReportOptions = {}): string {
  const width = options.width ?? 80;
  const cwd = options.cwd;
  const lines: string[] = [];

  if (options.file !== undefined) {
    lines.push(display(options.file, cwd));
  }
  const chain = options.chain ?? [];
  if (chain.length > 1) {
    lines.push(`extends: ${chain.map((entry) => display(entry, cwd)).join(' -> ')}`);
  }
  if (lines.length > 0) lines.push('');

  for (const finding of findings) {
    const where =
      finding.loc === undefined
        ? display(finding.file, cwd)
        : `${display(finding.file, cwd)}:${finding.loc.start.line}:${finding.loc.start.column}`;
    const option = finding.option === undefined ? '' : `  ${finding.option}`;
    lines.push(`${LABEL[finding.severity]}  ${finding.code}${option}`);
    lines.push(...wrap(finding.title, width, '  '));
    lines.push(`  at ${where}`);
    lines.push(...wrap(finding.consequence, width, '      '));
    lines.push(...wrap(`fix: ${finding.fix}`, width, '      '));
    lines.push('');
  }

  lines.push(summaryLine(summarize(findings)));
  return `${lines.join('\n')}\n`;
}

/** The machine-readable report. Stable key order, two-space indent. */
export function formatJson(findings: readonly Finding[], options: ReportOptions = {}): string {
  const payload = {
    file: options.file ?? null,
    chain: options.chain ?? [],
    summary: summarize(findings),
    findings: findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      title: finding.title,
      option: finding.option ?? null,
      file: finding.file,
      line: finding.loc?.start.line ?? null,
      column: finding.loc?.start.column ?? null,
      consequence: finding.consequence,
      fix: finding.fix,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
