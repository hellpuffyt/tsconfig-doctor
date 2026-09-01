/**
 * A tolerant JSONC parser.
 *
 * `tsconfig.json` is not JSON. TypeScript reads it with a scanner that accepts
 * `//` and slash-star comments and trailing commas, and that keeps going after
 * a syntax error rather than throwing. Anything that wants to diagnose a
 * tsconfig has to do the same, otherwise the most common real-world files fail
 * to load at all.
 *
 * This parser therefore has two jobs that a `JSON.parse` wrapper cannot do:
 *
 * 1. **Recover.** A malformed member does not abort the parse. The parser
 *    records a diagnostic, skips to the next plausible boundary, and returns
 *    whatever else it understood. A missing comma should not hide the twelve
 *    settings after it.
 * 2. **Remember where everything was.** Every node carries a {@link Loc}, so a
 *    finding can point at `tsconfig.json:12:5` instead of naming an option and
 *    leaving the reader to search for it. This matters most with `extends`
 *    chains, where the option under discussion is often in a different file
 *    from the one the user asked about.
 *
 * The parser is deliberately more permissive than TypeScript's: single-quoted
 * strings and unquoted keys are accepted *and* reported. Accepting them means a
 * user with a hand-edited file still gets their diagnosis; reporting them means
 * they also learn that `tsc` itself will reject the file.
 */

/** A point in the source text. Lines and columns are 1-based, offsets 0-based. */
export interface Position {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

/** A half-open source range. */
export interface Loc {
  readonly start: Position;
  readonly end: Position;
}

/** A plain JavaScript value, the result of stripping locations from a node. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/** A plain JSON object. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** How badly a parse problem breaks the file. */
export type JsoncSeverity = 'error' | 'warning';

/** A single problem found while parsing. */
export interface JsoncDiagnostic {
  readonly message: string;
  readonly position: Position;
  readonly severity: JsoncSeverity;
}

export interface StringNode {
  readonly kind: 'string';
  readonly value: string;
  readonly loc: Loc;
}
export interface NumberNode {
  readonly kind: 'number';
  readonly value: number;
  readonly loc: Loc;
}
export interface BooleanNode {
  readonly kind: 'boolean';
  readonly value: boolean;
  readonly loc: Loc;
}
export interface NullNode {
  readonly kind: 'null';
  readonly value: null;
  readonly loc: Loc;
}
export interface ArrayNode {
  readonly kind: 'array';
  readonly items: readonly JsonNode[];
  readonly loc: Loc;
}
export interface ObjectNode {
  readonly kind: 'object';
  readonly members: readonly JsonMember[];
  readonly loc: Loc;
}

/** One `"key": value` pair, with the location of the key itself. */
export interface JsonMember {
  readonly key: string;
  readonly keyLoc: Loc;
  readonly value: JsonNode;
}

/** Any node in the document tree. */
export type JsonNode = StringNode | NumberNode | BooleanNode | NullNode | ArrayNode | ObjectNode;

/** The outcome of a parse: whatever was understood, plus everything that was wrong with it. */
export interface ParseResult {
  /** The document root, or `undefined` if the text held no value at all. */
  readonly root: JsonNode | undefined;
  readonly diagnostics: readonly JsoncDiagnostic[];
}

type TokenKind =
  | 'string'
  | 'number'
  | 'true'
  | 'false'
  | 'null'
  | 'identifier'
  | '{'
  | '}'
  | '['
  | ']'
  | ':'
  | ','
  | 'unknown'
  | 'eof';

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly value: string | number | boolean | null;
  readonly loc: Loc;
}

const STRUCTURAL: Readonly<Record<string, TokenKind>> = {
  '{': '{',
  '}': '}',
  '[': '[',
  ']': ']',
  ':': ':',
  ',': ',',
};

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Characters TypeScript's own scanner treats as identifier starts in an
 * unquoted key. Kept deliberately narrow: anything wider starts swallowing
 * genuinely broken input as if it were a key.
 */
function isIdentifierChar(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    isDigit(ch) ||
    ch === '_' ||
    ch === '$' ||
    ch === '-'
  );
}

/** Tracks offsets and turns them into line/column pairs on demand. */
class Scanner {
  private pos = 0;
  private line = 1;
  private lineStart = 0;

  constructor(private readonly text: string) {}

  position(): Position {
    return { line: this.line, column: this.pos - this.lineStart + 1, offset: this.pos };
  }

  atEnd(): boolean {
    return this.pos >= this.text.length;
  }

  peek(ahead = 0): string {
    return this.text[this.pos + ahead] ?? '';
  }

  /** Consumes one character, keeping the line counter correct for LF and CRLF. */
  advance(): string {
    const ch = this.text[this.pos] ?? '';
    this.pos += 1;
    if (ch === '\r') {
      if (this.text[this.pos] === '\n') this.pos += 1;
      this.line += 1;
      this.lineStart = this.pos;
    } else if (ch === '\n') {
      this.line += 1;
      this.lineStart = this.pos;
    }
    return ch;
  }
}

class Tokenizer {
  private readonly scanner: Scanner;
  readonly diagnostics: JsoncDiagnostic[] = [];

  constructor(text: string) {
    // A UTF-8 BOM survives most editors and would otherwise be an "unknown
    // token" at 1:1 on a file that is perfectly valid.
    this.scanner = new Scanner(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  }

  private report(message: string, position: Position, severity: JsoncSeverity = 'error'): void {
    this.diagnostics.push({ message, position, severity });
  }

  private skipTrivia(): void {
    for (;;) {
      const ch = this.scanner.peek();
      if (ch === '') return;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
        this.scanner.advance();
        continue;
      }
      if (ch === '/' && this.scanner.peek(1) === '/') {
        while (!this.scanner.atEnd() && this.scanner.peek() !== '\n' && this.scanner.peek() !== '\r') {
          this.scanner.advance();
        }
        continue;
      }
      if (ch === '/' && this.scanner.peek(1) === '*') {
        const start = this.scanner.position();
        this.scanner.advance();
        this.scanner.advance();
        let closed = false;
        while (!this.scanner.atEnd()) {
          if (this.scanner.peek() === '*' && this.scanner.peek(1) === '/') {
            this.scanner.advance();
            this.scanner.advance();
            closed = true;
            break;
          }
          this.scanner.advance();
        }
        if (!closed) this.report('unterminated block comment', start);
        continue;
      }
      return;
    }
  }

  next(): Token {
    this.skipTrivia();
    const start = this.scanner.position();
    if (this.scanner.atEnd()) {
      return { kind: 'eof', text: '', value: null, loc: { start, end: start } };
    }

    const ch = this.scanner.peek();
    const structural = STRUCTURAL[ch];
    if (structural !== undefined) {
      this.scanner.advance();
      return { kind: structural, text: ch, value: null, loc: { start, end: this.scanner.position() } };
    }
    if (ch === '"' || ch === "'") return this.readString(start, ch);
    if (isDigit(ch) || ch === '-' || ch === '+' || ch === '.') return this.readNumber(start);
    if (isIdentifierChar(ch)) return this.readWord(start);

    this.scanner.advance();
    this.report(`unexpected character ${JSON.stringify(ch)}`, start);
    return { kind: 'unknown', text: ch, value: null, loc: { start, end: this.scanner.position() } };
  }

  private readString(start: Position, quote: string): Token {
    this.scanner.advance();
    let out = '';
    for (;;) {
      if (this.scanner.atEnd()) {
        this.report('unterminated string', start);
        break;
      }
      const ch = this.scanner.peek();
      if (ch === '\n' || ch === '\r') {
        this.report('unterminated string', start);
        break;
      }
      if (ch === quote) {
        this.scanner.advance();
        break;
      }
      if (ch === '\\') {
        const escapeAt = this.scanner.position();
        this.scanner.advance();
        out += this.readEscape(escapeAt);
        continue;
      }
      out += this.scanner.advance();
    }
    if (quote === "'") {
      this.report("single-quoted string; tsc requires double quotes", start, 'warning');
    }
    return { kind: 'string', text: out, value: out, loc: { start, end: this.scanner.position() } };
  }

  private readEscape(at: Position): string {
    if (this.scanner.atEnd()) {
      this.report('string ends in a backslash', at);
      return '';
    }
    const ch = this.scanner.advance();
    switch (ch) {
      case '"':
      case "'":
      case '\\':
      case '/':
        return ch;
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'u': {
        let hex = '';
        for (let i = 0; i < 4; i += 1) {
          const digit = this.scanner.peek();
          if (!/[0-9a-fA-F]/.test(digit)) break;
          hex += this.scanner.advance();
        }
        if (hex.length !== 4) {
          this.report('invalid \\u escape; expected four hex digits', at);
          return '';
        }
        return String.fromCharCode(parseInt(hex, 16));
      }
      default:
        this.report(`invalid escape \\${ch}`, at);
        return ch;
    }
  }

  private readNumber(start: Position): Token {
    let raw = '';
    if (this.scanner.peek() === '-' || this.scanner.peek() === '+') raw += this.scanner.advance();
    while (isDigit(this.scanner.peek())) raw += this.scanner.advance();
    if (this.scanner.peek() === '.') {
      raw += this.scanner.advance();
      while (isDigit(this.scanner.peek())) raw += this.scanner.advance();
    }
    if (this.scanner.peek() === 'e' || this.scanner.peek() === 'E') {
      raw += this.scanner.advance();
      if (this.scanner.peek() === '+' || this.scanner.peek() === '-') raw += this.scanner.advance();
      while (isDigit(this.scanner.peek())) raw += this.scanner.advance();
    }
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value)) {
      this.report(`invalid number ${JSON.stringify(raw)}`, start);
      return { kind: 'number', text: raw, value: 0, loc: { start, end: this.scanner.position() } };
    }
    return { kind: 'number', text: raw, value, loc: { start, end: this.scanner.position() } };
  }

  private readWord(start: Position): Token {
    let raw = '';
    while (isIdentifierChar(this.scanner.peek())) raw += this.scanner.advance();
    const loc = { start, end: this.scanner.position() };
    if (raw === 'true') return { kind: 'true', text: raw, value: true, loc };
    if (raw === 'false') return { kind: 'false', text: raw, value: false, loc };
    if (raw === 'null') return { kind: 'null', text: raw, value: null, loc };
    return { kind: 'identifier', text: raw, value: raw, loc };
  }
}

class Parser {
  private readonly tokenizer: Tokenizer;
  private current: Token;
  private readonly diagnostics: JsoncDiagnostic[];

  constructor(text: string) {
    this.tokenizer = new Tokenizer(text);
    this.diagnostics = this.tokenizer.diagnostics;
    this.current = this.tokenizer.next();
  }

  private bump(): Token {
    const token = this.current;
    this.current = this.tokenizer.next();
    return token;
  }

  private report(message: string, position: Position, severity: JsoncSeverity = 'error'): void {
    this.diagnostics.push({ message, position, severity });
  }

  private atEnd(): boolean {
    return this.current.kind === 'eof';
  }

  parse(): ParseResult {
    if (this.atEnd()) {
      this.report('empty document', this.current.loc.start);
      return { root: undefined, diagnostics: this.diagnostics };
    }
    const root = this.parseValue(0);
    if (!this.atEnd()) {
      this.report(`unexpected ${describe(this.current)} after the document`, this.current.loc.start);
    }
    return { root, diagnostics: this.diagnostics };
  }

  /**
   * Depth is capped so a file of ten thousand open brackets reports one error
   * rather than exhausting the stack. Real tsconfigs nest four or five deep.
   */
  private parseValue(depth: number): JsonNode {
    if (depth > 64) {
      const loc = this.current.loc;
      this.report('nesting is too deep', loc.start);
      this.skipToBoundary();
      return { kind: 'null', value: null, loc };
    }
    const token = this.current;
    switch (token.kind) {
      case '{':
        return this.parseObject(depth);
      case '[':
        return this.parseArray(depth);
      case 'string':
        this.bump();
        return { kind: 'string', value: token.value as string, loc: token.loc };
      case 'number':
        this.bump();
        return { kind: 'number', value: token.value as number, loc: token.loc };
      case 'true':
      case 'false':
        this.bump();
        return { kind: 'boolean', value: token.kind === 'true', loc: token.loc };
      case 'null':
        this.bump();
        return { kind: 'null', value: null, loc: token.loc };
      case 'identifier':
        this.bump();
        this.report(
          `unquoted value ${JSON.stringify(token.text)}; strings must be quoted`,
          token.loc.start,
        );
        return { kind: 'string', value: token.text, loc: token.loc };
      default:
        this.report(`expected a value but found ${describe(token)}`, token.loc.start);
        if (token.kind !== 'eof') this.bump();
        return { kind: 'null', value: null, loc: token.loc };
    }
  }

  private parseObject(depth: number): ObjectNode {
    const open = this.bump();
    const members: JsonMember[] = [];
    const seen = new Map<string, Position>();
    let expectSeparator = false;

    while (this.current.kind !== '}' && this.current.kind !== 'eof') {
      if (expectSeparator) {
        this.report(`expected ',' but found ${describe(this.current)}`, this.current.loc.start);
      }
      const keyToken = this.current;
      let key: string;
      if (keyToken.kind === 'string') {
        key = keyToken.value as string;
        this.bump();
      } else if (
        keyToken.kind === 'identifier' ||
        keyToken.kind === 'true' ||
        keyToken.kind === 'false' ||
        keyToken.kind === 'null'
      ) {
        key = keyToken.text;
        this.bump();
        this.report(`unquoted key ${JSON.stringify(key)}; tsc requires quoted keys`, keyToken.loc.start, 'warning');
      } else {
        this.report(`expected a property name but found ${describe(keyToken)}`, keyToken.loc.start);
        this.skipToBoundary();
        if (this.current.kind === ',') {
          this.bump();
          expectSeparator = false;
          continue;
        }
        break;
      }

      if (this.current.kind === ':') {
        this.bump();
      } else {
        this.report(`expected ':' after ${JSON.stringify(key)}`, this.current.loc.start);
      }

      const value = this.parseValue(depth + 1);
      const previous = seen.get(key);
      if (previous !== undefined) {
        this.report(
          `duplicate key ${JSON.stringify(key)}; the value at line ${previous.line} is discarded`,
          keyToken.loc.start,
          'warning',
        );
      }
      seen.set(key, keyToken.loc.start);
      members.push({ key, keyLoc: keyToken.loc, value });

      if (this.current.kind === ',') {
        this.bump();
        expectSeparator = false;
      } else {
        expectSeparator = true;
      }
    }

    const end = this.expectClose('}', open);
    return { kind: 'object', members, loc: { start: open.loc.start, end } };
  }

  private parseArray(depth: number): ArrayNode {
    const open = this.bump();
    const items: JsonNode[] = [];
    let expectSeparator = false;

    while (this.current.kind !== ']' && this.current.kind !== 'eof') {
      if (expectSeparator) {
        this.report(`expected ',' but found ${describe(this.current)}`, this.current.loc.start);
      }
      const before = this.current;
      items.push(this.parseValue(depth + 1));
      if (this.current === before) {
        // parseValue made no progress on a token it could not use.
        this.bump();
      }
      if (this.current.kind === ',') {
        this.bump();
        expectSeparator = false;
      } else {
        expectSeparator = true;
      }
    }

    const end = this.expectClose(']', open);
    return { kind: 'array', items, loc: { start: open.loc.start, end } };
  }

  private expectClose(kind: '}' | ']', open: Token): Position {
    if (this.current.kind === kind) {
      return this.bump().loc.end;
    }
    this.report(
      `unclosed ${open.text} opened at line ${open.loc.start.line}`,
      this.current.loc.start,
    );
    return this.current.loc.end;
  }

  /** Recovery: run forward to something that plausibly ends the broken construct. */
  private skipToBoundary(): void {
    while (
      this.current.kind !== 'eof' &&
      this.current.kind !== ',' &&
      this.current.kind !== '}' &&
      this.current.kind !== ']'
    ) {
      this.bump();
    }
  }
}

function describe(token: Token): string {
  if (token.kind === 'eof') return 'end of file';
  return JSON.stringify(token.text);
}

/**
 * Parses JSON with comments, trailing commas and syntax errors.
 *
 * Never throws. A file that is entirely garbage yields `root: undefined` and a
 * list of diagnostics; a file with one bad line yields every other line plus
 * one diagnostic.
 */
export function parseJsonc(text: string): ParseResult {
  return new Parser(text).parse();
}

/** Strips locations from a node, producing an ordinary JavaScript value. */
export function toPlain(node: JsonNode): JsonValue {
  switch (node.kind) {
    case 'object': {
      const out: JsonObject = {};
      for (const member of node.members) out[member.key] = toPlain(member.value);
      return out;
    }
    case 'array':
      return node.items.map(toPlain);
    default:
      return node.value;
  }
}

/** Finds a member of an object node by key. Later duplicates win, as in JSON. */
export function getMember(node: ObjectNode, key: string): JsonMember | undefined {
  let found: JsonMember | undefined;
  for (const member of node.members) {
    if (member.key === key) found = member;
  }
  return found;
}

/** Convenience: parse and return a plain value, ignoring recoverable problems. */
export function parseJsoncValue(text: string): JsonValue | undefined {
  const { root } = parseJsonc(text);
  return root === undefined ? undefined : toPlain(root);
}
