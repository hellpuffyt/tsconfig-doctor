/**
 * Rules whose text says "tsc rejects this (TSxxxx)" are checked against the
 * TypeScript compiler installed in this repository, so a wrong diagnostic
 * code or a stale version claim fails the suite instead of shipping. The
 * configs are parsed and validated in memory by the real compiler API.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { analyze } from '../src/analyze.js';
import { DEPRECATED_OPTIONS } from '../src/rules.js';
import { fromOptions } from './helpers.js';

/** Every diagnostic code tsc reports for these compiler options (config parsing + program options). */
function tscCodes(compilerOptions: Record<string, unknown>): number[] {
  const files: Record<string, string> = {
    '/p/tsconfig.json': JSON.stringify({ compilerOptions, files: ['a.ts'] }),
    '/p/a.ts': 'export const x = 1;\n',
  };
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    readDirectory: () => [],
    fileExists: (f) => f in files,
    readFile: (f) => files[f],
  };
  const raw = ts.readConfigFile('/p/tsconfig.json', (f) => files[f]);
  const parsed = ts.parseJsonConfigFileContent(raw.config, host, '/p', undefined, '/p/tsconfig.json');
  const compilerHost = ts.createCompilerHost(parsed.options);
  compilerHost.readFile = (f) => files[f] ?? ts.sys.readFile(f);
  compilerHost.fileExists = (f) => f in files || ts.sys.fileExists(f);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, host: compilerHost });
  return [...parsed.errors, ...program.getOptionsDiagnostics()].map((d) => d.code);
}

function ruleText(options: Record<string, unknown>, code: string): string {
  const finding = analyze(fromOptions(options, { include: ['src'] })).find((f) => f.code === code);
  if (!finding) throw new Error(`${code} did not fire for ${JSON.stringify(options)}`);
  return `${finding.title} ${finding.consequence}`;
}

const MAJOR_MINOR = ts.versionMajorMinor;
const AT_LEAST_5_6 = Number(MAJOR_MINOR.split('.')[0]) > 5 || Number(MAJOR_MINOR.split('.')[1]) >= 6;

describe(`rule claims against the installed TypeScript ${ts.version}`, () => {
  const cases: [string, Record<string, unknown>, number][] = [
    ['TSD016', { strictPropertyInitialization: true, strictNullChecks: false }, 5052],
    ['TSD027', { allowImportingTsExtensions: true }, 5096],
    ['TSD028', { resolveJsonModule: true, moduleResolution: 'classic', module: 'commonjs' }, 5070],
    ['TSD053', { emitDecoratorMetadata: true }, 5052],
    ['TSD081', { composite: true, declaration: false }, 6304],
  ];
  for (const [code, options, tsCode] of cases) {
    it(`${code}: tsc reports TS${String(tsCode)}, and the rule names that code`, () => {
      expect(tscCodes(options)).toContain(tsCode);
      expect(ruleText(options, code)).toContain(`TS${String(tsCode)}`);
    });
  }

  it.runIf(AT_LEAST_5_6)('TSD042: target es3 is removed (TS5108) even with ignoreDeprecations', () => {
    expect(tscCodes({ target: 'es3' })).toContain(5108);
    expect(tscCodes({ target: 'es3', ignoreDeprecations: '5.0' })).toContain(5108);
    expect(ruleText({ target: 'es3' }, 'TSD042')).toContain('TS5108');
  });

  it.runIf(AT_LEAST_5_6)('TSD082: every deprecated option is removed (TS5102) even with ignoreDeprecations', () => {
    const sample: Record<string, unknown> = {
      charset: 'utf8',
      importsNotUsedAsValues: 'error',
      keyofStringsOnly: true,
      noImplicitUseStrict: true,
      noStrictGenericChecks: true,
      out: 'bundle.js',
      preserveValueImports: true,
      suppressExcessPropertyErrors: true,
      suppressImplicitAnyIndexErrors: true,
    };
    expect(Object.keys(sample).sort()).toEqual([...DEPRECATED_OPTIONS.keys()].sort());
    for (const [option, value] of Object.entries(sample)) {
      expect(tscCodes({ [option]: value, ignoreDeprecations: '5.0' }), option).toContain(5102);
    }
    expect(ruleText({ charset: 'utf8' }, 'TSD082')).toContain('TS5102');
  });
});
