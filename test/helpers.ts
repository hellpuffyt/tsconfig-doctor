/**
 * Test helpers.
 *
 * Two ways to build a config are used throughout the suite, deliberately:
 *
 * - {@link fromFiles} builds one from an in-memory map. Fast, hermetic, and the
 *   right tool for a rule that only cares about two options.
 * - {@link fixture} reads a committed tsconfig from `test/fixtures`. Slower, but
 *   it proves the tool works on files that a person could open, and it keeps
 *   the examples in the README honest.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { analyze, type AnalyzeOptions } from '../src/analyze.js';
import { createMemoryHost, createNodeHost, loadConfig, type Host } from '../src/config.js';
import { dirname, toPosix } from '../src/paths.js';
import type { Finding, ResolvedConfig } from '../src/types.js';

/** Absolute posix path of the `test` directory. */
export const TEST_DIR = dirname(toPosix(fileURLToPath(import.meta.url)));

/** Absolute posix path of the `test/fixtures` directory. */
export const FIXTURES = `${TEST_DIR}/fixtures`;

/** A host that reads the real fixture files. */
export function fixtureHost(): Host {
  return createNodeHost((path) => readFileSync(path, 'utf8'));
}

/** Loads a committed fixture by directory name, e.g. `fixture('strict-off')`. */
export function fixture(name: string, file = 'tsconfig.json'): ResolvedConfig {
  return loadConfig(`${FIXTURES}/${name}/${file}`, fixtureHost(), FIXTURES);
}

/** Loads a config from an in-memory file map. */
export function fromFiles(
  files: Readonly<Record<string, string>>,
  entry = '/p/tsconfig.json',
): ResolvedConfig {
  return loadConfig(entry, createMemoryHost(files), '/p');
}

/** Builds a single-file config from compiler options plus optional top-level keys. */
export function fromOptions(
  compilerOptions: Record<string, unknown>,
  topLevel: Record<string, unknown> = {},
): ResolvedConfig {
  return fromFiles({
    '/p/tsconfig.json': JSON.stringify({ compilerOptions, ...topLevel }, null, 2),
  });
}

/** Analyses compiler options directly and returns the finding codes. */
export function codesFor(
  compilerOptions: Record<string, unknown>,
  topLevel: Record<string, unknown> = {},
  options: AnalyzeOptions = {},
): string[] {
  return analyze(fromOptions(compilerOptions, topLevel), options).map((finding) => finding.code);
}

/** The finding with the given code, or `undefined`. */
export function findByCode(findings: readonly Finding[], code: string): Finding | undefined {
  return findings.find((finding) => finding.code === code);
}

/**
 * A config that every rule is happy with, used as the baseline when testing one
 * rule at a time. If this ever stops producing an empty report, a rule has
 * become unavoidable and needs rethinking rather than a test edit.
 */
export const CLEAN_OPTIONS: Readonly<Record<string, unknown>> = {
  target: 'es2022',
  module: 'nodenext',
  moduleResolution: 'nodenext',
  moduleDetection: 'force',
  useDefineForClassFields: true,
  esModuleInterop: true,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noPropertyAccessFromIndexSignature: true,
  noEmit: true,
};

/** The clean baseline with the given overrides applied. */
export function clean(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const merged = { ...CLEAN_OPTIONS, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }
  return merged;
}

/** Codes reported for the clean baseline plus overrides. */
export function cleanCodes(
  overrides: Record<string, unknown> = {},
  topLevel: Record<string, unknown> = { include: ['src'] },
): string[] {
  return codesFor(clean(overrides), topLevel);
}
