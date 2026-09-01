import { describe, expect, it } from 'vitest';

import {
  getMember,
  parseJsonc,
  parseJsoncValue,
  toPlain,
  type ObjectNode,
} from '../src/jsonc.js';

function value(text: string): unknown {
  return parseJsoncValue(text);
}

function messages(text: string): string[] {
  return parseJsonc(text).diagnostics.map((diagnostic) => diagnostic.message);
}

function root(text: string): ObjectNode {
  const parsed = parseJsonc(text).root;
  if (parsed === undefined || parsed.kind !== 'object') throw new Error('expected an object');
  return parsed;
}

describe('values', () => {
  it('parses an empty object', () => {
    expect(value('{}')).toEqual({});
  });

  it('parses nested objects and arrays', () => {
    expect(value('{"a":{"b":[1,2,{"c":true}]}}')).toEqual({ a: { b: [1, 2, { c: true }] } });
  });

  it('parses the three literals', () => {
    expect(value('[true,false,null]')).toEqual([true, false, null]);
  });

  it('parses negative, fractional and exponent numbers', () => {
    expect(value('[-1, 2.5, 1e3, 1E-2, +7]')).toEqual([-1, 2.5, 1000, 0.01, 7]);
  });

  it('parses every standard string escape', () => {
    expect(value('"a\\"b\\\\c\\/d\\be\\ff\\ng\\rh\\ti"')).toBe('a"b\\c/d\be\ff\ng\rh\ti');
  });

  it('parses a unicode escape', () => {
    expect(value('"\\u0041\\u00e9"')).toBe('Aé');
  });

  it('parses a top-level string, number and boolean', () => {
    expect(value('"hello"')).toBe('hello');
    expect(value('42')).toBe(42);
    expect(value('false')).toBe(false);
  });

  it('keeps the last of two duplicate keys, as JSON does', () => {
    expect(value('{"a":1,"a":2}')).toEqual({ a: 2 });
  });
});

describe('jsonc extensions', () => {
  it('ignores line comments', () => {
    expect(value('{\n// a comment\n"a":1 // trailing\n}')).toEqual({ a: 1 });
  });

  it('ignores block comments, including multi-line ones', () => {
    expect(value('{/* one */ "a": /* two\nthree */ 1}')).toEqual({ a: 1 });
  });

  it('accepts a trailing comma in an object', () => {
    expect(value('{"a":1,}')).toEqual({ a: 1 });
    expect(messages('{"a":1,}')).toEqual([]);
  });

  it('accepts a trailing comma in an array', () => {
    expect(value('[1,2,]')).toEqual([1, 2]);
    expect(messages('[1,2,]')).toEqual([]);
  });

  it('skips a UTF-8 BOM', () => {
    expect(value('﻿{"a":1}')).toEqual({ a: 1 });
    expect(messages('﻿{"a":1}')).toEqual([]);
  });

  it('reports a division-looking slash rather than treating it as a comment', () => {
    expect(messages('{"a": 1 / 2}')[0]).toContain('unexpected character');
  });
});

describe('locations', () => {
  it('records 1-based lines and columns for keys', () => {
    const node = root('{\n  "compilerOptions": {\n    "strict": true\n  }\n}');
    const outer = getMember(node, 'compilerOptions');
    expect(outer?.keyLoc.start).toMatchObject({ line: 2, column: 3 });
    const inner = outer?.value;
    if (inner?.kind !== 'object') throw new Error('expected an object');
    expect(getMember(inner, 'strict')?.keyLoc.start).toMatchObject({ line: 3, column: 5 });
  });

  it('counts CRLF as one line break', () => {
    const node = root('{\r\n  "a": 1,\r\n  "b": 2\r\n}');
    expect(getMember(node, 'b')?.keyLoc.start.line).toBe(3);
  });

  it('counts a lone CR as a line break', () => {
    const node = root('{\r  "a": 1\r}');
    expect(getMember(node, 'a')?.keyLoc.start.line).toBe(2);
  });

  it('records offsets that index back into the source', () => {
    const text = '{ "target": "es2022" }';
    const node = root(text);
    const member = getMember(node, 'target');
    expect(text.slice(member?.keyLoc.start.offset ?? 0, member?.keyLoc.end.offset ?? 0)).toBe(
      '"target"',
    );
  });

  it('points a diagnostic at the offending line', () => {
    const parsed = parseJsonc('{\n  "a": 1\n  "b": 2\n}');
    expect(parsed.diagnostics[0]?.position.line).toBe(3);
  });
});

describe('recovery', () => {
  it('reports a missing comma but keeps both members', () => {
    const parsed = parseJsonc('{"a":1 "b":2}');
    expect(toPlain(parsed.root!)).toEqual({ a: 1, b: 2 });
    expect(parsed.diagnostics[0]?.message).toContain("expected ','");
  });

  it('reports a missing colon but keeps the value', () => {
    const parsed = parseJsonc('{"a" 1}');
    expect(toPlain(parsed.root!)).toEqual({ a: 1 });
    expect(parsed.diagnostics[0]?.message).toContain("expected ':'");
  });

  it('keeps the members that precede an unclosed object', () => {
    const parsed = parseJsonc('{"a":1, "b":{"c":2}');
    expect(toPlain(parsed.root!)).toEqual({ a: 1, b: { c: 2 } });
    expect(parsed.diagnostics[0]?.message).toContain('unclosed {');
  });

  it('keeps the items that precede an unclosed array', () => {
    const parsed = parseJsonc('{"a":[1,2}');
    expect(parsed.diagnostics.some((d) => d.message.includes('unclosed ['))).toBe(true);
  });

  it('recovers from a non-name where a key belongs', () => {
    const parsed = parseJsonc('{ 1: 2, "a": 3 }');
    expect(toPlain(parsed.root!)).toEqual({ a: 3 });
    expect(parsed.diagnostics[0]?.message).toContain('expected a property name');
  });

  it('recovers from a stray token inside an array', () => {
    const parsed = parseJsonc('[1, }, 2]');
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
  });

  it('reports trailing content after the document', () => {
    expect(messages('{"a":1} garbage')[0]).toContain('after the document');
  });

  it('caps nesting depth instead of overflowing the stack', () => {
    const parsed = parseJsonc('['.repeat(500));
    expect(parsed.diagnostics.some((d) => d.message === 'nesting is too deep')).toBe(true);
  });
});

describe('malformed input', () => {
  it('reports an empty document and returns no root', () => {
    const parsed = parseJsonc('');
    expect(parsed.root).toBeUndefined();
    expect(parsed.diagnostics[0]?.message).toBe('empty document');
  });

  it('reports a document of only whitespace and comments', () => {
    expect(parseJsonc('  // nothing here\n').root).toBeUndefined();
  });

  it('reports an unterminated string', () => {
    expect(messages('{"a": "oops}')).toContain('unterminated string');
  });

  it('reports a string broken by a newline', () => {
    expect(messages('{"a": "oops\n"}')).toContain('unterminated string');
  });

  it('reports a string that ends in a backslash', () => {
    expect(messages('"abc\\')).toContain('string ends in a backslash');
  });

  it('reports an invalid escape and keeps the character', () => {
    expect(messages('"a\\qb"')[0]).toContain('invalid escape');
    expect(value('"a\\qb"')).toBe('aqb');
  });

  it('reports a short unicode escape', () => {
    expect(messages('"\\u12"')[0]).toContain('four hex digits');
  });

  it('reports an unterminated block comment', () => {
    expect(messages('{"a":1} /* open')).toContain('unterminated block comment');
  });

  it('reports an unexpected character', () => {
    expect(messages('{"a": @}')[0]).toContain('unexpected character');
  });

  it('reports a number that is only a sign', () => {
    expect(messages('[-]')[0]).toContain('invalid number');
  });

  it('warns about single-quoted strings but still reads them', () => {
    const parsed = parseJsonc("{'a': 'b'}");
    expect(toPlain(parsed.root!)).toEqual({ a: 'b' });
    expect(parsed.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    expect(parsed.diagnostics[0]?.message).toContain('double quotes');
  });

  it('warns about unquoted keys but still reads them', () => {
    const parsed = parseJsonc('{ strict: true }');
    expect(toPlain(parsed.root!)).toEqual({ strict: true });
    expect(parsed.diagnostics[0]?.message).toContain('unquoted key');
  });

  it('treats a keyword used as a key as a key', () => {
    expect(value('{ true: 1 }')).toEqual({ true: 1 });
  });

  it('reports an unquoted value', () => {
    expect(messages('{"a": bare}')[0]).toContain('unquoted value');
  });

  it('warns about a duplicate key and names the discarded line', () => {
    const parsed = parseJsonc('{\n"a":1,\n"a":2\n}');
    expect(parsed.diagnostics[0]?.message).toContain('duplicate key');
    expect(parsed.diagnostics[0]?.message).toContain('line 2');
  });

  it('never throws on random bytes', () => {
    for (const text of ['{', '}', '[', ']', ':', ',', '\\', '"', '{{{', '::::', '{"a"']) {
      expect(() => parseJsonc(text)).not.toThrow();
    }
  });
});

describe('helpers', () => {
  it('getMember returns undefined for an absent key', () => {
    expect(getMember(root('{"a":1}'), 'b')).toBeUndefined();
  });

  it('parseJsoncValue returns undefined for an empty document', () => {
    expect(parseJsoncValue('')).toBeUndefined();
  });

  it('toPlain round-trips a document through JSON', () => {
    const text = '{"a":[1,"two",false,null],"b":{"c":3}}';
    expect(JSON.stringify(toPlain(parseJsonc(text).root!))).toBe(text);
  });
});
