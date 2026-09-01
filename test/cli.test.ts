import { describe, expect, it } from 'vitest';

import { createMemoryHost } from '../src/config.js';
import { resolveConfigPath, run, type Io } from '../src/cli.js';
import { VERSION } from '../src/version.js';
import { clean } from './helpers.js';

interface Capture {
  readonly io: Io;
  out(): string;
  err(): string;
}

function capture(files: Readonly<Record<string, string>>, cwd = '/p'): Capture {
  let out = '';
  let err = '';
  return {
    io: {
      host: createMemoryHost(files),
      cwd,
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    },
    out: () => out,
    err: () => err,
  };
}

const CLEAN_FILE = JSON.stringify({ compilerOptions: clean(), include: ['src'] }, null, 2);
const LOOSE_FILE = JSON.stringify({ compilerOptions: { strict: false } }, null, 2);

describe('help, version and rule listing', () => {
  it('--help prints usage and exits 0', () => {
    const c = capture({});
    expect(run(['--help'], c.io)).toBe(0);
    expect(c.out()).toContain('usage:');
    expect(c.out()).toContain('--min-severity');
  });

  it('-h is the same as --help', () => {
    const c = capture({});
    run(['-h'], c.io);
    expect(c.out()).toContain('tsconfig-doctor');
  });

  it('--version prints the package version', () => {
    const c = capture({});
    expect(run(['--version'], c.io)).toBe(0);
    expect(c.out()).toBe(`${VERSION}\n`);
  });

  it('-V is the same as --version', () => {
    const c = capture({});
    run(['-V'], c.io);
    expect(c.out()).toBe(`${VERSION}\n`);
  });

  it('--list-rules prints one line per rule', () => {
    const c = capture({});
    expect(run(['--list-rules'], c.io)).toBe(0);
    const lines = c.out().trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(40);
    expect(lines[0]).toMatch(/^TSD001\t/);
  });
});

describe('exit codes', () => {
  it('is 0 for a config with nothing to report', () => {
    const c = capture({ '/p/tsconfig.json': CLEAN_FILE });
    expect(run([], c.io)).toBe(0);
    expect(c.out()).toContain('no findings');
  });

  it('is 1 when an error is reported', () => {
    const c = capture({ '/p/tsconfig.json': LOOSE_FILE });
    expect(run([], c.io)).toBe(1);
  });

  it('is 0 when only notes are reported and --fail-on is error', () => {
    const c = capture({
      '/p/tsconfig.json': JSON.stringify({
        compilerOptions: clean({ typeRoots: ['./types'] }),
        include: ['src'],
      }),
    });
    expect(run([], c.io)).toBe(0);
    expect(c.out()).toContain('TSD065');
  });

  it('is 1 when --fail-on info and a note is reported', () => {
    const c = capture({
      '/p/tsconfig.json': JSON.stringify({
        compilerOptions: clean({ typeRoots: ['./types'] }),
        include: ['src'],
      }),
    });
    expect(run(['--fail-on', 'info'], c.io)).toBe(1);
  });

  it('is 0 for --fail-on never however bad the config is', () => {
    const c = capture({ '/p/tsconfig.json': LOOSE_FILE });
    expect(run(['--fail-on', 'never'], c.io)).toBe(0);
  });

  it('is 0 when the only findings are below --fail-on warning', () => {
    const c = capture({
      '/p/tsconfig.json': JSON.stringify({
        compilerOptions: clean({ typeRoots: ['./types'] }),
        include: ['src'],
      }),
    });
    expect(run(['--fail-on', 'warning'], c.io)).toBe(0);
  });

  it('is 1 for a config file that does not exist', () => {
    const c = capture({});
    expect(run([], c.io)).toBe(1);
    expect(c.out()).toContain('TSD900');
  });
});

describe('path handling', () => {
  it('defaults to ./tsconfig.json in the cwd', () => {
    const c = capture({ '/p/tsconfig.json': CLEAN_FILE });
    run([], c.io);
    expect(c.out()).toContain('tsconfig.json');
  });

  it('accepts a directory', () => {
    const c = capture({ '/p/packages/api/tsconfig.json': CLEAN_FILE });
    expect(run(['packages/api'], c.io)).toBe(0);
  });

  it('accepts an explicit file name', () => {
    const c = capture({ '/p/tsconfig.build.json': CLEAN_FILE });
    expect(run(['tsconfig.build.json'], c.io)).toBe(0);
  });

  it('accepts an absolute path', () => {
    const c = capture({ '/other/tsconfig.json': CLEAN_FILE });
    expect(run(['/other/tsconfig.json'], c.io)).toBe(0);
  });

  it('resolveConfigPath appends tsconfig.json to a directory that has one', () => {
    const host = createMemoryHost({ '/p/api/tsconfig.json': '{}' });
    expect(resolveConfigPath('api', '/p', host)).toBe('/p/api/tsconfig.json');
  });

  it('resolveConfigPath keeps an extensionless file that exists', () => {
    const host = createMemoryHost({ '/p/jsconfig': '{}' });
    expect(resolveConfigPath('jsconfig', '/p', host)).toBe('/p/jsconfig');
  });

  it('resolveConfigPath falls back to the directory form when nothing exists', () => {
    const host = createMemoryHost({});
    expect(resolveConfigPath('missing', '/p', host)).toBe('/p/missing/tsconfig.json');
  });
});

describe('output selection', () => {
  it('--json emits parseable JSON', () => {
    const c = capture({ '/p/tsconfig.json': LOOSE_FILE });
    run(['--json'], c.io);
    const parsed = JSON.parse(c.out());
    expect(parsed.summary.error).toBeGreaterThan(0);
    expect(parsed.file).toBe('/p/tsconfig.json');
  });

  it('--min-severity error hides warnings and notes', () => {
    const c = capture({ '/p/tsconfig.json': LOOSE_FILE });
    run(['--json', '--min-severity', 'error'], c.io);
    const parsed = JSON.parse(c.out());
    expect(parsed.summary.warning).toBe(0);
    expect(parsed.summary.info).toBe(0);
  });

  it('--ignore removes the named codes', () => {
    const c = capture({ '/p/tsconfig.json': LOOSE_FILE });
    run(['--json', '--ignore', 'TSD001,TSD002'], c.io);
    const codes = JSON.parse(c.out()).findings.map((f: { code: string }) => f.code);
    expect(codes).not.toContain('TSD001');
    expect(codes).not.toContain('TSD002');
  });

  it('--only keeps just the named codes', () => {
    const c = capture({ '/p/tsconfig.json': LOOSE_FILE });
    run(['--json', '--only', 'TSD001'], c.io);
    expect(JSON.parse(c.out()).findings.map((f: { code: string }) => f.code)).toEqual(['TSD001']);
  });

  it('--width narrows the prose', () => {
    const c = capture({ '/p/tsconfig.json': LOOSE_FILE });
    run(['--width', '50'], c.io);
    const wide = capture({ '/p/tsconfig.json': LOOSE_FILE });
    run([], wide.io);
    expect(c.out().split('\n').length).toBeGreaterThan(wide.out().split('\n').length);
  });

  it('prints the extends chain for an inherited config', () => {
    const c = capture({
      '/p/base.json': CLEAN_FILE,
      '/p/tsconfig.json': '{"extends":"./base.json","include":["src"]}',
    });
    run([], c.io);
    expect(c.out()).toContain('extends: base.json -> tsconfig.json');
  });
});

describe('argument errors', () => {
  const bad: [string, string[]][] = [
    ['an unknown option', ['--nope']],
    ['two paths', ['a.json', 'b.json']],
    ['--min-severity with no value', ['--min-severity']],
    ['--min-severity with a bad value', ['--min-severity', 'loud']],
    ['--fail-on with a bad value', ['--fail-on', 'loud']],
    ['--ignore with no value', ['--ignore']],
    ['--only with no value', ['--only']],
    ['--width with no value', ['--width']],
    ['--width that is not a number', ['--width', 'wide']],
    ['--width below the minimum', ['--width', '10']],
  ];

  for (const [name, argv] of bad) {
    it(`exits 2 for ${name}`, () => {
      const c = capture({ '/p/tsconfig.json': CLEAN_FILE });
      expect(run(argv, c.io)).toBe(2);
      expect(c.err()).toContain('tsconfig-doctor:');
      expect(c.err()).toContain('--help');
      expect(c.out()).toBe('');
    });
  }

  it('accepts an upper-case severity', () => {
    const c = capture({ '/p/tsconfig.json': CLEAN_FILE });
    expect(run(['--min-severity', 'ERROR'], c.io)).toBe(0);
  });

  it('accepts --fail-on NEVER in any case', () => {
    const c = capture({ '/p/tsconfig.json': LOOSE_FILE });
    expect(run(['--fail-on', 'NEVER'], c.io)).toBe(0);
  });
});
