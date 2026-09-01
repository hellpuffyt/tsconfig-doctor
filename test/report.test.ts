import { describe, expect, it } from 'vitest';

import { analyze, summarize } from '../src/analyze.js';
import { formatJson, formatText, summaryLine, wrap } from '../src/report.js';
import type { Finding } from '../src/types.js';
import { clean, fromFiles, fromOptions } from './helpers.js';

const SAMPLE: Finding[] = [
  {
    code: 'TSD002',
    severity: 'error',
    title: 'every type silently includes null and undefined',
    option: 'strict',
    file: '/p/tsconfig.json',
    loc: { start: { line: 4, column: 5, offset: 40 }, end: { line: 4, column: 13, offset: 48 } },
    consequence: 'A value annotated string may be undefined at runtime.',
    fix: 'Set strict to true.',
  },
  {
    code: 'TSD060',
    severity: 'info',
    title: 'the program is every file under the config directory',
    file: '/p/tsconfig.json',
    consequence: 'A scratch file becomes part of the build.',
    fix: 'Add an include.',
  },
];

describe('wrap', () => {
  it('breaks on spaces and applies the indent to every line', () => {
    expect(wrap('one two three four', 12, '  ')).toEqual(['  one two', '  three four']);
  });

  it('returns nothing for empty text', () => {
    expect(wrap('   ', 40, '')).toEqual([]);
  });

  it('lets a single long word overflow rather than breaking it', () => {
    expect(wrap('/very/long/path/that/exceeds/the/width', 10, '')).toEqual([
      '/very/long/path/that/exceeds/the/width',
    ]);
  });

  it('collapses runs of whitespace', () => {
    expect(wrap('a \n b', 40, '')).toEqual(['a b']);
  });
});

describe('summaryLine', () => {
  it('reports an empty run', () => {
    expect(summaryLine(summarize([]))).toBe('no findings');
  });

  it('pluralises each category independently', () => {
    expect(summaryLine({ error: 1, warning: 2, info: 0, total: 3 })).toBe('1 error, 2 warnings');
    expect(summaryLine({ error: 0, warning: 1, info: 1, total: 2 })).toBe('1 warning, 1 note');
    expect(summaryLine({ error: 2, warning: 0, info: 3, total: 5 })).toBe('2 errors, 3 notes');
  });
});

describe('formatText', () => {
  it('prints one block per finding, with the location', () => {
    const text = formatText(SAMPLE, { file: '/p/tsconfig.json' });
    expect(text).toContain('error    TSD002  strict');
    expect(text).toContain('at /p/tsconfig.json:4:5');
    expect(text).toContain('fix: Set strict to true.');
  });

  it('omits the location when the finding has none', () => {
    const text = formatText([SAMPLE[1]!], {});
    expect(text).toContain('at /p/tsconfig.json\n');
  });

  it('labels notes as notes', () => {
    expect(formatText([SAMPLE[1]!], {})).toContain('note     TSD060');
  });

  it('ends with the summary line', () => {
    expect(formatText(SAMPLE, {}).trimEnd().split('\n').at(-1)).toBe('1 error, 1 note');
  });

  it('says so when there is nothing to report', () => {
    expect(formatText([], { file: '/p/tsconfig.json' })).toContain('no findings');
  });

  it('prints the extends chain when there is more than one file', () => {
    const text = formatText([], { file: '/p/tsconfig.json', chain: ['/p/base.json', '/p/tsconfig.json'] });
    expect(text).toContain('extends: /p/base.json -> /p/tsconfig.json');
  });

  it('omits the chain header for a single file', () => {
    expect(formatText([], { file: '/p/tsconfig.json', chain: ['/p/tsconfig.json'] })).not.toContain(
      'extends:',
    );
  });

  it('shortens paths relative to the cwd when that is shorter', () => {
    const text = formatText(SAMPLE, { file: '/p/tsconfig.json', cwd: '/p' });
    expect(text).toContain('at tsconfig.json:4:5');
  });

  it('keeps the absolute path when the relative one would be longer', () => {
    const text = formatText(SAMPLE, { file: '/p/tsconfig.json', cwd: '/a/b/c/d/e/f' });
    expect(text).toContain('/p/tsconfig.json');
  });

  it('respects the width', () => {
    const findings = analyze(fromOptions({ strict: false }));
    for (const line of formatText(findings, { width: 60 }).split('\n')) {
      // Long unbreakable tokens are allowed to overflow; nothing else is.
      if (line.includes(' ') && !/\S{40}/.test(line)) expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it('is byte-identical between runs', () => {
    const findings = analyze(fromOptions({ strict: false }));
    expect(formatText(findings, { cwd: '/p' })).toBe(formatText(findings, { cwd: '/p' }));
  });
});

describe('formatJson', () => {
  it('parses back into the documented shape', () => {
    const parsed = JSON.parse(formatJson(SAMPLE, { file: '/p/tsconfig.json', chain: ['/p/tsconfig.json'] }));
    expect(parsed.file).toBe('/p/tsconfig.json');
    expect(parsed.chain).toEqual(['/p/tsconfig.json']);
    expect(parsed.summary).toEqual({ error: 1, warning: 0, info: 1, total: 2 });
    expect(parsed.findings).toHaveLength(2);
  });

  it('uses null rather than omitting absent fields', () => {
    const parsed = JSON.parse(formatJson(SAMPLE));
    expect(parsed.file).toBeNull();
    expect(parsed.findings[1].option).toBeNull();
    expect(parsed.findings[1].line).toBeNull();
    expect(parsed.findings[1].column).toBeNull();
  });

  it('reports line and column as numbers', () => {
    const parsed = JSON.parse(formatJson(SAMPLE));
    expect(parsed.findings[0].line).toBe(4);
    expect(parsed.findings[0].column).toBe(5);
  });

  it('ends with a newline', () => {
    expect(formatJson([]).endsWith('\n')).toBe(true);
  });

  it('carries the prose fields through unchanged', () => {
    const config = fromFiles({
      '/p/base.json': JSON.stringify({ compilerOptions: { ...clean(), skipLibCheck: true } }),
      '/p/tsconfig.json': '{"extends":"./base.json","include":["src"]}',
    });
    const findings = analyze(config);
    const parsed = JSON.parse(formatJson(findings));
    const entry = parsed.findings.find((f: { code: string }) => f.code === 'TSD017');
    expect(entry.file).toBe('/p/base.json');
    expect(entry.consequence).toContain('declaration file');
  });
});
