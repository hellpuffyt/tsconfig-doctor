/**
 * `extends` resolution and merge semantics.
 *
 * These are the behaviours that a naive "read the file and look at
 * compilerOptions" implementation gets wrong, and they are the reason the
 * loader exists as a separate layer from the rules.
 */

import { describe, expect, it } from 'vitest';

import { createMemoryHost, loadConfig, resolveExtends } from '../src/config.js';
import { fromFiles } from './helpers.js';

const BASE = JSON.stringify({
  compilerOptions: { strict: true, target: 'es2020', lib: ['ES2020'] },
  include: ['src'],
});

describe('merging', () => {
  it('inherits options from the base', () => {
    const config = fromFiles({
      '/p/base.json': BASE,
      '/p/tsconfig.json': '{"extends":"./base.json"}',
    });
    expect(config.options.get('strict')?.value).toBe(true);
    expect(config.options.get('target')?.value).toBe('es2020');
  });

  it('lets the child override one option without losing the others', () => {
    const config = fromFiles({
      '/p/base.json': BASE,
      '/p/tsconfig.json': '{"extends":"./base.json","compilerOptions":{"target":"es2022"}}',
    });
    expect(config.options.get('target')?.value).toBe('es2022');
    expect(config.options.get('strict')?.value).toBe(true);
  });

  it('replaces an inherited array rather than merging into it', () => {
    const config = fromFiles({
      '/p/base.json': BASE,
      '/p/tsconfig.json': '{"extends":"./base.json","compilerOptions":{"lib":["DOM"]}}',
    });
    expect(config.options.get('lib')?.value).toEqual(['DOM']);
  });

  it('records which file declared the winning value', () => {
    const config = fromFiles({
      '/p/base.json': BASE,
      '/p/tsconfig.json': '{"extends":"./base.json","compilerOptions":{"target":"es2022"}}',
    });
    expect(config.options.get('strict')?.file).toBe('/p/base.json');
    expect(config.options.get('target')?.file).toBe('/p/tsconfig.json');
  });

  it('records the files that were overridden', () => {
    const config = fromFiles({
      '/p/base.json': BASE,
      '/p/tsconfig.json': '{"extends":"./base.json","compilerOptions":{"target":"es2022"}}',
    });
    expect(config.options.get('target')?.overridden).toEqual(['/p/base.json']);
    expect(config.options.get('strict')?.overridden).toEqual([]);
  });

  it('inherits include and exclude, and lets the child replace them', () => {
    const config = fromFiles({
      '/p/base.json': BASE,
      '/p/tsconfig.json': '{"extends":"./base.json","include":["lib"]}',
    });
    expect(config.topLevel.get('include')?.value).toEqual(['lib']);
  });

  it('does not inherit references', () => {
    const config = fromFiles({
      '/p/base.json': '{"references":[{"path":"./a"}]}',
      '/p/a/tsconfig.json': '{"compilerOptions":{"composite":true}}',
      '/p/tsconfig.json': '{"extends":"./base.json"}',
    });
    expect(config.references).toEqual([]);
  });

  it('reports the whole chain, root-most first', () => {
    const config = fromFiles({
      '/p/base.json': BASE,
      '/p/middle.json': '{"extends":"./base.json"}',
      '/p/tsconfig.json': '{"extends":"./middle.json"}',
    });
    expect(config.chain).toEqual(['/p/base.json', '/p/middle.json', '/p/tsconfig.json']);
  });

  it('applies an array of bases left to right, so the last one wins', () => {
    const config = fromFiles({
      '/p/one.json': '{"compilerOptions":{"target":"es2017","strict":true}}',
      '/p/two.json': '{"compilerOptions":{"target":"es2022"}}',
      '/p/tsconfig.json': '{"extends":["./one.json","./two.json"]}',
    });
    expect(config.options.get('target')?.value).toBe('es2022');
    expect(config.options.get('strict')?.value).toBe(true);
    expect(config.chain).toEqual(['/p/one.json', '/p/two.json', '/p/tsconfig.json']);
  });

  it('lists a shared grandparent only once in the chain', () => {
    const config = fromFiles({
      '/p/base.json': BASE,
      '/p/one.json': '{"extends":"./base.json"}',
      '/p/two.json': '{"extends":"./base.json"}',
      '/p/tsconfig.json': '{"extends":["./one.json","./two.json"]}',
    });
    expect(config.chain).toEqual([
      '/p/base.json',
      '/p/one.json',
      '/p/two.json',
      '/p/tsconfig.json',
    ]);
  });
});

describe('specifier resolution', () => {
  const host = createMemoryHost({
    '/p/base.json': BASE,
    '/p/configs/tsconfig.json': BASE,
    '/p/node_modules/@tsconfig/node20/tsconfig.json': BASE,
    '/p/node_modules/shared-config.json': BASE,
    '/node_modules/hoisted/tsconfig.json': BASE,
  });

  it('resolves a relative path', () => {
    expect(resolveExtends('./base.json', '/p/tsconfig.json', host)).toBe('/p/base.json');
  });

  it('appends .json when the specifier has no extension', () => {
    expect(resolveExtends('./base', '/p/tsconfig.json', host)).toBe('/p/base.json');
  });

  it('falls back to tsconfig.json inside a directory', () => {
    expect(resolveExtends('./configs', '/p/tsconfig.json', host)).toBe(
      '/p/configs/tsconfig.json',
    );
  });

  it('resolves an absolute path', () => {
    expect(resolveExtends('/p/base.json', '/q/tsconfig.json', host)).toBe('/p/base.json');
  });

  it('resolves a package with an explicit subpath', () => {
    expect(resolveExtends('@tsconfig/node20/tsconfig.json', '/p/a/tsconfig.json', host)).toBe(
      '/p/node_modules/@tsconfig/node20/tsconfig.json',
    );
  });

  it('resolves a bare package name to its tsconfig.json', () => {
    expect(resolveExtends('@tsconfig/node20', '/p/tsconfig.json', host)).toBe(
      '/p/node_modules/@tsconfig/node20/tsconfig.json',
    );
  });

  it('resolves a package that is a bare .json file', () => {
    expect(resolveExtends('shared-config', '/p/tsconfig.json', host)).toBe(
      '/p/node_modules/shared-config.json',
    );
  });

  it('walks up to a hoisted node_modules', () => {
    expect(resolveExtends('hoisted', '/p/a/b/tsconfig.json', host)).toBe(
      '/node_modules/hoisted/tsconfig.json',
    );
  });

  it('returns undefined for a package that is not installed', () => {
    expect(resolveExtends('missing-config', '/p/tsconfig.json', host)).toBeUndefined();
  });

  it('returns undefined for a relative path that does not exist', () => {
    expect(resolveExtends('./nowhere.json', '/p/tsconfig.json', host)).toBeUndefined();
  });
});

describe('failures', () => {
  it('reports a missing base and keeps the child options', () => {
    const config = fromFiles({
      '/p/tsconfig.json': '{"extends":"./nowhere.json","compilerOptions":{"strict":true}}',
    });
    expect(config.problems.map((p) => p.code)).toContain('TSD904');
    expect(config.options.get('strict')?.value).toBe(true);
  });

  it('reports a circular chain exactly once and does not hang', () => {
    const config = fromFiles({
      '/p/a.json': '{"extends":"./b.json"}',
      '/p/b.json': '{"extends":"./a.json","compilerOptions":{"strict":true}}',
      '/p/tsconfig.json': '{"extends":"./a.json"}',
    });
    expect(config.problems.filter((p) => p.code === 'TSD905')).toHaveLength(1);
    expect(config.options.get('strict')?.value).toBe(true);
  });

  it('reports a self-referential extends', () => {
    const config = fromFiles({ '/p/tsconfig.json': '{"extends":"./tsconfig.json"}' });
    expect(config.problems.map((p) => p.code)).toContain('TSD905');
  });

  it('reports a non-string extends', () => {
    const config = fromFiles({ '/p/tsconfig.json': '{"extends":42}' });
    expect(config.problems.map((p) => p.code)).toContain('TSD906');
  });

  it('reports a non-string entry inside an extends array', () => {
    const config = fromFiles({
      '/p/base.json': BASE,
      '/p/tsconfig.json': '{"extends":["./base.json",42]}',
    });
    expect(config.problems.map((p) => p.code)).toContain('TSD906');
    expect(config.options.get('strict')?.value).toBe(true);
  });

  it('surfaces a syntax error in a base config', () => {
    const config = fromFiles({
      '/p/base.json': '{"compilerOptions":{"strict":true',
      '/p/tsconfig.json': '{"extends":"./base.json"}',
    });
    const parse = config.problems.find((p) => p.code === 'TSD901');
    expect(parse?.file).toBe('/p/base.json');
  });

  it('reports a missing entry file', () => {
    const config = fromFiles({}, '/p/tsconfig.json');
    expect(config.problems.map((p) => p.code)).toEqual(['TSD900']);
    expect(config.options.size).toBe(0);
  });

  it('reports a non-object root', () => {
    const config = fromFiles({ '/p/tsconfig.json': '["strict"]' });
    expect(config.problems.map((p) => p.code)).toContain('TSD902');
  });

  it('reports a non-object compilerOptions', () => {
    const config = fromFiles({ '/p/tsconfig.json': '{"compilerOptions":"strict"}' });
    expect(config.problems.map((p) => p.code)).toContain('TSD903');
    expect(config.options.size).toBe(0);
  });
});

describe('references', () => {
  const files = {
    '/p/tsconfig.json': JSON.stringify({
      files: [],
      references: [{ path: './alpha' }, { path: './beta' }, { path: './gamma' }],
    }),
    '/p/alpha/tsconfig.json': '{"compilerOptions":{"composite":true}}',
    '/p/beta/tsconfig.json': '{"compilerOptions":{"strict":true}}',
  };

  it('resolves a directory reference to its tsconfig.json', () => {
    const config = fromFiles(files);
    expect(config.references[0]?.resolved).toBe('/p/alpha/tsconfig.json');
  });

  it('reads composite from the referenced project', () => {
    const config = fromFiles(files);
    expect(config.references[0]?.composite).toBe(true);
    expect(config.references[1]?.composite).toBe(false);
  });

  it('reports a reference that is not composite', () => {
    const config = fromFiles(files);
    expect(config.problems.map((p) => p.code)).toContain('TSD908');
  });

  it('reports a reference that does not exist', () => {
    const config = fromFiles(files);
    const missing = config.problems.find((p) => p.code === 'TSD907');
    expect(missing?.title).toContain('gamma');
  });

  it('resolves a reference given as an explicit .json path', () => {
    const config = fromFiles({
      '/p/tsconfig.json': '{"references":[{"path":"./alpha/tsconfig.json"}]}',
      '/p/alpha/tsconfig.json': '{"compilerOptions":{"composite":true}}',
    });
    expect(config.references[0]?.resolved).toBe('/p/alpha/tsconfig.json');
  });

  it('reports references that are not an array', () => {
    const config = fromFiles({ '/p/tsconfig.json': '{"references":"./alpha"}' });
    expect(config.problems.map((p) => p.code)).toContain('TSD909');
  });

  it('reports a reference entry that is not an object', () => {
    const config = fromFiles({ '/p/tsconfig.json': '{"references":["./alpha"]}' });
    expect(config.problems.map((p) => p.code)).toContain('TSD909');
  });

  it('reports a reference entry with no path', () => {
    const config = fromFiles({ '/p/tsconfig.json': '{"references":[{"prepend":true}]}' });
    expect(config.problems.map((p) => p.code)).toContain('TSD909');
  });

  it('does not follow a reference back to the entry config', () => {
    const config = fromFiles({
      '/p/tsconfig.json': '{"references":[{"path":"./tsconfig.json"}]}',
    });
    expect(config.references[0]?.composite).toBeUndefined();
    expect(config.problems.map((p) => p.code)).not.toContain('TSD908');
  });
});

describe('entry path handling', () => {
  it('resolves a relative entry path against the given cwd', () => {
    const host = createMemoryHost({ '/w/p/tsconfig.json': '{"compilerOptions":{"strict":true}}' });
    const config = loadConfig('p/tsconfig.json', host, '/w');
    expect(config.fileName).toBe('/w/p/tsconfig.json');
  });

  it('defaults the cwd to the root when none is given', () => {
    const host = createMemoryHost({ '/tsconfig.json': '{"compilerOptions":{"strict":true}}' });
    expect(loadConfig('tsconfig.json', host).fileName).toBe('/tsconfig.json');
  });

  it('accepts a windows-style absolute path', () => {
    const host = createMemoryHost({ 'C:/p/tsconfig.json': '{"compilerOptions":{}}' });
    expect(loadConfig('C:\\p\\tsconfig.json', host).fileName).toBe('C:/p/tsconfig.json');
  });
});
