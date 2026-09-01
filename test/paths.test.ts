import { describe, expect, it } from 'vitest';

import {
  basename,
  dirname,
  hasJsonExtension,
  isAbsolutePath,
  joinPath,
  normalizePath,
  relativePath,
  resolvePath,
  toPosix,
} from '../src/paths.js';

describe('toPosix', () => {
  it('converts backslashes', () => {
    expect(toPosix('C:\\a\\b')).toBe('C:/a/b');
  });

  it('collapses repeated separators', () => {
    expect(toPosix('a//b\\\\c')).toBe('a/b/c');
  });
});

describe('isAbsolutePath', () => {
  it('recognises posix, windows and unc-ish roots', () => {
    expect(isAbsolutePath('/a')).toBe(true);
    expect(isAbsolutePath('C:/a')).toBe(true);
    expect(isAbsolutePath('c:/a')).toBe(true);
  });

  it('rejects relative paths', () => {
    expect(isAbsolutePath('a/b')).toBe(false);
    expect(isAbsolutePath('./a')).toBe(false);
    expect(isAbsolutePath('C:a')).toBe(false);
  });
});

describe('dirname and basename', () => {
  it('splits a nested path', () => {
    expect(dirname('/a/b/c.json')).toBe('/a/b');
    expect(basename('/a/b/c.json')).toBe('c.json');
  });

  it('handles a file at the posix root', () => {
    expect(dirname('/c.json')).toBe('/');
  });

  it('handles a file at a windows drive root', () => {
    expect(dirname('C:/c.json')).toBe('C:/');
    expect(basename('C:/c.json')).toBe('c.json');
  });

  it('returns "." for a bare name', () => {
    expect(dirname('c.json')).toBe('.');
    expect(basename('c.json')).toBe('c.json');
  });
});

describe('normalizePath', () => {
  it('removes . and .. segments', () => {
    expect(normalizePath('/a/./b/../c')).toBe('/a/c');
  });

  it('keeps leading .. on a relative path', () => {
    expect(normalizePath('../a/../b')).toBe('../b');
  });

  it('cannot escape a root', () => {
    expect(normalizePath('/../../a')).toBe('/a');
    expect(normalizePath('C:/../a')).toBe('C:/a');
  });

  it('returns "." for an empty relative path', () => {
    expect(normalizePath('a/..')).toBe('.');
  });
});

describe('joinPath', () => {
  it('joins and normalizes', () => {
    expect(joinPath('/a', 'b', '../c')).toBe('/a/c');
  });

  it('ignores empty segments', () => {
    expect(joinPath('', '/a', '', 'b')).toBe('/a/b');
  });

  it('returns "." with no segments', () => {
    expect(joinPath()).toBe('.');
  });
});

describe('resolvePath', () => {
  it('resolves a relative path against the base', () => {
    expect(resolvePath('/a/b', '../c/d.json')).toBe('/a/c/d.json');
  });

  it('returns an absolute path unchanged apart from normalizing', () => {
    expect(resolvePath('/a', '/x/./y')).toBe('/x/y');
  });
});

describe('relativePath', () => {
  it('produces a short path within a shared root', () => {
    expect(relativePath('/a/b', '/a/b/c/d.json')).toBe('c/d.json');
  });

  it('walks up when needed', () => {
    expect(relativePath('/a/b/c', '/a/x.json')).toBe('../../x.json');
  });

  it('falls back to the absolute path across different roots', () => {
    expect(relativePath('/a', 'C:/b')).toBe('C:/b');
  });

  it('returns "." for the same path', () => {
    expect(relativePath('/a/b', '/a/b')).toBe('.');
  });
});

describe('hasJsonExtension', () => {
  it('is case-insensitive', () => {
    expect(hasJsonExtension('a.json')).toBe(true);
    expect(hasJsonExtension('a.JSON')).toBe(true);
  });

  it('rejects a directory name', () => {
    expect(hasJsonExtension('packages/api')).toBe(false);
  });
});
