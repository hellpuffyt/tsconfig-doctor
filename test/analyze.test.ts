import { describe, expect, it } from 'vitest';

import { analyze, summarize } from '../src/analyze.js';
import type { Rule } from '../src/rules.js';
import { clean, cleanCodes, fromFiles, fromOptions } from './helpers.js';

const LOOSE = { strict: false, target: 'es5' };

describe('filters', () => {
  it('drops ignored codes', () => {
    const codes = cleanCodes({ strict: undefined }, { include: ['src'] });
    expect(codes).toContain('TSD002');
    const filtered = analyze(fromOptions(clean({ strict: undefined }), { include: ['src'] }), {
      ignore: ['TSD002'],
    });
    expect(filtered.map((f) => f.code)).not.toContain('TSD002');
  });

  it('matches ignore codes case-insensitively and ignores whitespace', () => {
    const filtered = analyze(fromOptions(clean({ strict: undefined })), {
      ignore: [' tsd002 ', ''],
    });
    expect(filtered.map((f) => f.code)).not.toContain('TSD002');
  });

  it('keeps only the requested codes', () => {
    const filtered = analyze(fromOptions(LOOSE), { only: ['TSD001'] });
    expect(filtered.map((f) => f.code)).toEqual(['TSD001']);
  });

  it('drops findings below the minimum severity', () => {
    const filtered = analyze(fromOptions(LOOSE), { minSeverity: 'error' });
    expect(filtered.every((f) => f.severity === 'error')).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
  });

  it('warning severity keeps warnings and errors but no notes', () => {
    const filtered = analyze(fromOptions(LOOSE), { minSeverity: 'warning' });
    expect(filtered.some((f) => f.severity === 'info')).toBe(false);
    expect(filtered.some((f) => f.severity === 'warning')).toBe(true);
  });

  it('applies the same filters to loader problems', () => {
    const config = fromFiles({ '/p/tsconfig.json': '{"extends":"./nowhere.json"}' });
    expect(analyze(config, { ignore: ['TSD904'] }).map((f) => f.code)).not.toContain('TSD904');
  });

  it('runs a caller-supplied rule set instead of the built-ins', () => {
    const rule: Rule = {
      code: 'X001',
      run: () => ({ severity: 'info', title: 't', consequence: 'c', fix: 'f' }),
    };
    expect(analyze(fromOptions(LOOSE), { rules: [rule] }).map((f) => f.code)).toEqual(['X001']);
  });
});

describe('ordering', () => {
  it('sorts errors before warnings before notes', () => {
    const order = analyze(fromOptions(LOOSE)).map((f) => f.severity);
    const rank = { error: 2, warning: 1, info: 0 };
    for (let index = 1; index < order.length; index += 1) {
      expect(rank[order[index - 1]!]).toBeGreaterThanOrEqual(rank[order[index]!]);
    }
  });

  it('sorts by code within a severity', () => {
    const errors = analyze(fromOptions(LOOSE)).filter((f) => f.severity === 'error');
    const codes = errors.map((f) => f.code);
    expect([...codes].sort()).toEqual(codes);
  });

  it('is stable across repeated runs', () => {
    const once = analyze(fromOptions(LOOSE));
    const twice = analyze(fromOptions(LOOSE));
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it('breaks ties between same-code findings by option name', () => {
    const codes = analyze(fromOptions(clean({ charset: 'a', out: 'b' })))
      .filter((f) => f.code === 'TSD082')
      .map((f) => f.option);
    expect(codes).toEqual(['charset', 'out']);
  });
});

describe('attribution', () => {
  it('points at the file that declared the option, not the entry file', () => {
    const config = fromFiles({
      '/p/base.json': JSON.stringify({ compilerOptions: { ...clean(), skipLibCheck: true } }),
      '/p/tsconfig.json': '{"extends":"./base.json","include":["src"]}',
    });
    const finding = analyze(config).find((f) => f.code === 'TSD017');
    expect(finding?.file).toBe('/p/base.json');
    expect(finding?.loc?.start.line).toBeGreaterThan(0);
  });

  it('falls back to the entry file when no option is implicated', () => {
    const config = fromOptions(clean(), {});
    const finding = analyze(config).find((f) => f.code === 'TSD060');
    expect(finding?.file).toBe('/p/tsconfig.json');
    expect(finding?.loc).toBeUndefined();
  });

  it('locates a top-level key such as exclude', () => {
    const config = fromOptions(clean({ outDir: 'dist' }), {
      include: ['src'],
      exclude: ['node_modules'],
    });
    const finding = analyze(config).find((f) => f.code === 'TSD064');
    expect(finding?.option).toBe('exclude');
    expect(finding?.loc).toBeDefined();
  });
});

describe('summarize', () => {
  it('counts an empty list as zero', () => {
    expect(summarize([])).toEqual({ error: 0, warning: 0, info: 0, total: 0 });
  });

  it('counts each severity', () => {
    const summary = summarize(analyze(fromOptions(LOOSE)));
    expect(summary.total).toBe(summary.error + summary.warning + summary.info);
    expect(summary.error).toBeGreaterThan(0);
  });
});

describe('every finding is well formed', () => {
  it('has a code, a title, a consequence and a fix', () => {
    for (const finding of analyze(fromOptions(LOOSE))) {
      expect(finding.code).toMatch(/^TSD\d{3}$/);
      expect(finding.title.length).toBeGreaterThan(10);
      expect(finding.consequence.length).toBeGreaterThan(60);
      expect(finding.fix.length).toBeGreaterThan(10);
    }
  });

  it('never phrases a title as a bare restatement of the setting', () => {
    for (const finding of analyze(fromOptions(LOOSE))) {
      expect(finding.title).not.toMatch(/^`?\w+`? is (off|false|not set)\.?$/);
    }
  });
});
