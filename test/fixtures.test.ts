/**
 * The committed fixtures.
 *
 * Everything here reads a real file from `test/fixtures` through the real Node
 * host. The in-memory tests prove the rules; these prove that a file a person
 * could actually open produces the report the README claims it does.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { analyze } from '../src/analyze.js';
import { createNodeHost, loadConfig } from '../src/config.js';
import { nodeIo, run } from '../src/cli.js';
import { formatText } from '../src/report.js';
import { VERSION } from '../src/version.js';
import { FIXTURES, fixture, fixtureHost } from './helpers.js';

function codes(name: string, file?: string): string[] {
  return analyze(fixture(name, file)).map((finding) => finding.code);
}

describe('bare', () => {
  it('an empty compilerOptions is a long list of silent defaults', () => {
    const found = codes('bare');
    for (const code of ['TSD001', 'TSD002', 'TSD023', 'TSD040', 'TSD060']) {
      expect(found, code).toContain(code);
    }
  });

  it('reports the defaults as errors, not as notes', () => {
    expect(analyze(fixture('bare')).some((f) => f.severity === 'error')).toBe(true);
  });
});

describe('strict-on', () => {
  it('produces no findings at all', () => {
    expect(codes('strict-on')).toEqual([]);
  });
});

describe('strict-off', () => {
  it('reports the whole strict family plus the interop and path traps', () => {
    const found = codes('strict-off');
    for (const code of ['TSD002', 'TSD003', 'TSD017', 'TSD018', 'TSD029', 'TSD041']) {
      expect(found, code).toContain(code);
    }
  });

  it('points TSD002 at the line where strictNullChecks is written', () => {
    const finding = analyze(fixture('strict-off')).find((f) => f.code === 'TSD002');
    const source = readFileSync(finding!.file, 'utf8').split('\n');
    expect(source[(finding!.loc?.start.line ?? 1) - 1]).toContain('strictNullChecks');
  });
});

describe('jsonc', () => {
  it('reads a config with comments and trailing commas without complaint', () => {
    const config = fixture('jsonc');
    expect(config.problems).toEqual([]);
    expect(config.options.get('strict')?.value).toBe(true);
  });

  it('reports no parse findings', () => {
    expect(codes('jsonc')).not.toContain('TSD901');
  });
});

describe('malformed', () => {
  it('recovers from a missing comma and still reads every option', () => {
    const config = fixture('malformed', 'missing-comma.json');
    expect(config.problems.map((p) => p.code)).toContain('TSD901');
    expect(config.options.get('target')?.value).toBe('es2022');
    expect(config.options.get('moduleDetection')?.value).toBe('force');
  });

  it('recovers from an unclosed object', () => {
    const config = fixture('malformed', 'unclosed.json');
    expect(config.options.get('strict')?.value).toBe(true);
  });

  it('reports a root that is not an object', () => {
    expect(codes('malformed', 'not-an-object.json')).toContain('TSD902');
  });

  it('reports a compilerOptions that is not an object', () => {
    expect(codes('malformed', 'options-not-an-object.json')).toContain('TSD903');
  });

  it('reports an empty file', () => {
    const found = codes('malformed', 'empty.json');
    expect(found).toContain('TSD901');
    expect(found).toContain('TSD902');
  });

  it('reads single-quoted JSON but warns that tsc will not', () => {
    const config = fixture('malformed', 'single-quotes.json');
    expect(config.options.get('strict')?.value).toBe(true);
    const parse = config.problems.filter((p) => p.code === 'TSD901');
    expect(parse.length).toBeGreaterThan(0);
    expect(parse.every((p) => p.severity === 'warning')).toBe(true);
  });

  it('never throws on any malformed fixture', () => {
    for (const file of [
      'missing-comma.json',
      'unclosed.json',
      'not-an-object.json',
      'options-not-an-object.json',
      'empty.json',
      'single-quotes.json',
    ]) {
      expect(() => analyze(fixture('malformed', file)), file).not.toThrow();
    }
  });
});

describe('extends fixtures', () => {
  it('resolves a three-file chain in order', () => {
    const config = fixture('extends-chain');
    expect(config.chain.map((entry) => entry.split('/').at(-1))).toEqual([
      'base.json',
      'middle.json',
      'tsconfig.json',
    ]);
  });

  it('lets the middle config win over the base', () => {
    expect(fixture('extends-chain').options.get('target')?.value).toBe('es2022');
  });

  it('reports the leaf turning strict back off', () => {
    expect(codes('extends-chain')).toContain('TSD085');
  });

  it('applies an array of bases left to right', () => {
    const config = fixture('extends-array');
    expect(config.options.get('target')?.value).toBe('es2022');
    expect(config.options.get('verbatimModuleSyntax')?.value).toBe(true);
  });

  it('reports a base that cannot be found', () => {
    expect(codes('extends-missing')).toContain('TSD904');
  });

  it('reports a cycle without hanging', () => {
    expect(codes('extends-cycle', 'a.json')).toContain('TSD905');
  });

  it('resolves a base inside node_modules', () => {
    const config = fixture('extends-package');
    expect(config.chain.some((entry) => entry.includes('node_modules'))).toBe(true);
    expect(config.options.get('strict')?.value).toBe(true);
  });

  it('attributes an inherited option to the package that declared it', () => {
    const config = fixture('extends-package');
    expect(config.options.get('strict')?.file).toContain('@tsconfig/strictest');
  });

  it('reports inherited relative paths in a monorepo package', () => {
    const found = analyze(fixture('inherited', 'packages/api/tsconfig.json'));
    const inherited = found.filter((f) => f.code === 'TSD084');
    expect(inherited.map((f) => f.option).sort()).toEqual(['outDir', 'rootDir']);
  });
});

describe('references fixture', () => {
  it('flags the package that is not composite and the one that is missing', () => {
    const found = codes('references');
    expect(found).toContain('TSD907');
    expect(found).toContain('TSD908');
  });

  it('reads composite from each referenced project', () => {
    const config = fixture('references');
    expect(config.references.map((reference) => reference.composite)).toEqual([
      true,
      false,
      undefined,
    ]);
  });

  it('notes that a non-composite root only honours references under tsc -b', () => {
    expect(codes('references')).toContain('TSD080');
  });
});

describe('legacy and unknown fixtures', () => {
  it('reports every deprecated option and the removed target', () => {
    const found = codes('legacy');
    expect(found.filter((code) => code === 'TSD082')).toHaveLength(4);
    expect(found).toContain('TSD042');
  });

  it('reports both misspelled options', () => {
    const found = analyze(fixture('unknown')).filter((f) => f.code === 'TSD083');
    expect(found.map((f) => f.option).sort()).toEqual(['noUnusedVariables', 'strictNullCheck']);
  });
});

describe('the node host', () => {
  it('returns undefined for a file that does not exist', () => {
    expect(fixtureHost().readFile(`${FIXTURES}/nope.json`)).toBeUndefined();
  });

  it('reads a file that does exist', () => {
    expect(fixtureHost().readFile(`${FIXTURES}/bare/tsconfig.json`)).toContain('compilerOptions');
  });

  it('loads through the real file system end to end', () => {
    const config = loadConfig(
      `${FIXTURES}/strict-on/tsconfig.json`,
      createNodeHost((path) => readFileSync(path, 'utf8')),
    );
    expect(formatText(analyze(config), { cwd: FIXTURES })).toContain('no findings');
  });

  it('drives the CLI through a node-style io adapter', () => {
    let out = '';
    const io = nodeIo(
      (path) => readFileSync(path, 'utf8'),
      FIXTURES,
      (text) => {
        out += text;
      },
      () => undefined,
    );
    expect(run(['strict-on'], io)).toBe(0);
    expect(out).toContain('no findings');
  });

  it('reports its own version through the adapter', () => {
    let out = '';
    const io = nodeIo(
      (path) => readFileSync(path, 'utf8'),
      FIXTURES,
      (text) => {
        out += text;
      },
      () => undefined,
    );
    run(['--version'], io);
    expect(out.trim()).toBe(VERSION);
  });
});
