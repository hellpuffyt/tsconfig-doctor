/**
 * Checks on the package itself.
 *
 * The zero-dependency promise is the kind of thing that is true on the day it
 * is written and quietly false a year later, so it is asserted rather than
 * documented. The same goes for the version constant and for the tool's own
 * tsconfigs, which the README presents as examples of a clean report.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/analyze.js';
import { createNodeHost, loadConfig } from '../src/config.js';
import { RULES } from '../src/rules.js';
import { VERSION } from '../src/version.js';
import { dirname } from '../src/paths.js';
import { TEST_DIR } from './helpers.js';

const ROOT = dirname(TEST_DIR);

interface PackageJson {
  version: string;
  dependencies?: Record<string, string>;
  bin?: Record<string, string>;
  type?: string;
  engines?: { node?: string };
}

const pkg = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8')) as PackageJson;

describe('package.json', () => {
  it('has no runtime dependencies', () => {
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('agrees with the exported VERSION constant', () => {
    expect(pkg.version).toBe(VERSION);
  });

  it('declares a console entry point', () => {
    expect(pkg.bin?.['tsconfig-doctor']).toBe('dist/bin.js');
  });

  it('is an ES module requiring Node 20 or newer', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.engines?.node).toBe('>=20');
  });
});

describe('this repository dogfoods the tool', () => {
  const host = createNodeHost((path) => readFileSync(path, 'utf8'));

  it('tsconfig.json produces no findings', () => {
    const findings = analyze(loadConfig(`${ROOT}/tsconfig.json`, host));
    expect(findings.map((finding) => `${finding.code} ${finding.title}`)).toEqual([]);
  });

  it('tsconfig.build.json produces no findings', () => {
    const findings = analyze(loadConfig(`${ROOT}/tsconfig.build.json`, host));
    expect(findings.map((finding) => `${finding.code} ${finding.title}`)).toEqual([]);
  });
});

describe('the README stays honest', () => {
  const readme = readFileSync(`${ROOT}/README.md`, 'utf8');

  it('documents every rule code', () => {
    for (const rule of RULES) {
      expect(readme, rule.code).toContain(rule.code);
    }
  });

  it('documents every structural code the loader can emit', () => {
    for (const code of ['TSD900', 'TSD901', 'TSD902', 'TSD903', 'TSD904', 'TSD905', 'TSD906', 'TSD907', 'TSD908', 'TSD909']) {
      expect(readme, code).toContain(code);
    }
  });

  it('does not document a code that no longer exists', () => {
    const documented = new Set(readme.match(/TSD\d{3}/g) ?? []);
    const real = new Set([
      ...RULES.map((rule) => rule.code),
      'TSD900',
      'TSD901',
      'TSD902',
      'TSD903',
      'TSD904',
      'TSD905',
      'TSD906',
      'TSD907',
      'TSD908',
      'TSD909',
    ]);
    for (const code of documented) expect(real.has(code), code).toBe(true);
  });
});
