// Tiny expression evaluator for the `derived` field type on
// schema-driven collections (see plans/done/feat-mc-invoice.md).
//
// Grammar (recursive-descent, no precedence climbing — five
// non-terminals total):
//
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := number | sumCall | identifier | '(' expr ')'
//   sumCall:= 'sum' '(' sumArg ')'
//   sumArg := tableCol (('*' | '/') tableCol)*      // e.g. lineItems[].quantity * lineItems[].rate
//   tableCol := identifier '[]' '.' identifier
//
// `identifier` accepts top-level field names (single segment).
// Inside `sumArg`, identifiers are the `<table>[].col` form.
//
// What's deliberately NOT supported (and would parse-error rather
// than silently misbehave):
//   - String literals, boolean operators, comparisons, conditionals
//   - Nested function calls beyond `sum(...)`
//   - Anything in the record that isn't a number / table-of-objects
//
// All evaluation is pure — no eval(), no Function constructor.
// Returns `null` on any failure (parse error, unbound identifier,
// non-finite arithmetic). The caller renders `null` as em-dash in
// the table cell + form display.

export interface FormulaContext {
  /** The record being evaluated. For derived fields in the form,
   *  this is the live draft (text + table both converted via the
   *  same `draftToRecord` pipeline). For the main table cell,
   *  this is the persisted item. */
  record: Record<string, unknown>;
}

export function evaluateDerived(formula: string, ctx: FormulaContext): number | null {
  let tokens: Token[];
  try {
    tokens = tokenize(formula);
  } catch {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-use-before-define -- Parser class is defined later in the file (grouped with its AST + evaluator); evaluateDerived runs after module init so the TDZ concern doesn't apply.
  const parser = new Parser(tokens);
  let ast: Node;
  try {
    ast = parser.parseExpr();
    if (!parser.atEnd()) return null; // trailing junk
  } catch {
    return null;
  }
  const value = evaluate(ast, ctx);
  return Number.isFinite(value) ? value : null;
}

// ─── Tokens ────────────────────────────────────────────────

type TokenKind = "number" | "ident" | "(" | ")" | "+" | "-" | "*" | "/" | "[]" | ".";

interface Token {
  kind: TokenKind;
  value?: string | number;
}

const SINGLE_CHAR_PUNCT = new Set<TokenKind>(["(", ")", "+", "-", "*", "/", "."]);

interface Cursor {
  input: string;
  index: number;
}

function consumeWhitespace(cur: Cursor): boolean {
  const char = cur.input[cur.index];
  if (char === " " || char === "\t" || char === "\n") {
    cur.index++;
    return true;
  }
  return false;
}

function consumeNumber(cur: Cursor): Token | null {
  const char = cur.input[cur.index] ?? "";
  const next = cur.input[cur.index + 1] ?? "";
  if (!isDigit(char) && !(char === "." && isDigit(next))) return null;
  let raw = "";
  while (cur.index < cur.input.length) {
    const here = cur.input[cur.index] ?? "";
    if (!isDigit(here) && here !== ".") break;
    raw += here;
    cur.index++;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) throw new Error("bad number");
  return { kind: "number", value: num };
}

function consumeIdent(cur: Cursor): Token | null {
  const char = cur.input[cur.index] ?? "";
  if (!isIdentStart(char)) return null;
  let raw = "";
  while (cur.index < cur.input.length && isIdentChar(cur.input[cur.index] ?? "")) {
    raw += cur.input[cur.index];
    cur.index++;
  }
  return { kind: "ident", value: raw };
}

function consumePunct(cur: Cursor): Token | null {
  const char = cur.input[cur.index] ?? "";
  if (char === "[" && cur.input[cur.index + 1] === "]") {
    cur.index += 2;
    return { kind: "[]" };
  }
  if (SINGLE_CHAR_PUNCT.has(char as TokenKind)) {
    cur.index++;
    return { kind: char as TokenKind };
  }
  return null;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const cur: Cursor = { input, index: 0 };
  while (cur.index < input.length) {
    if (consumeWhitespace(cur)) continue;
    // Number FIRST so a leading-dot literal (`.25`) isn't split by
    // the `.` punctuation branch.
    const numTok = consumeNumber(cur);
    if (numTok) {
      tokens.push(numTok);
      continue;
    }
    const punctTok = consumePunct(cur);
    if (punctTok) {
      tokens.push(punctTok);
      continue;
    }
    const identTok = consumeIdent(cur);
    if (identTok) {
      tokens.push(identTok);
      continue;
    }
    throw new Error(`unexpected char ${input[cur.index]}`);
  }
  return tokens;
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}
function isIdentStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}
function isIdentChar(char: string): boolean {
  return isIdentStart(char) || isDigit(char);
}

// ─── AST + Parser ───────────────────────────────────────────

type Node =
  | { kind: "num"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "binop"; operator: "+" | "-" | "*" | "/"; left: Node; right: Node }
  | { kind: "sum"; arg: SumArg };

interface SumArg {
  // factors multiplied/divided together; each is a (tableName, colName) ref into a row.
  factors: { table: string; col: string }[];
  /** Operators between factors: length = factors.length - 1; each
   *  is "*" or "/". For a single-factor sum (`sum(lineItems[].amount)`)
   *  this is empty. */
  operators: ("*" | "/")[];
}

class Parser {
  private cursor = 0;
  constructor(private readonly tokens: Token[]) {}

  atEnd(): boolean {
    return this.cursor >= this.tokens.length;
  }
  private peek(): Token | undefined {
    return this.tokens[this.cursor];
  }
  private consume(): Token {
    const tok = this.tokens[this.cursor++];
    if (!tok) throw new Error("unexpected end of input");
    return tok;
  }
  private expect(kind: TokenKind): Token {
    const tok = this.consume();
    if (tok.kind !== kind) throw new Error(`expected ${kind}, got ${tok.kind}`);
    return tok;
  }

  parseExpr(): Node {
    let left = this.parseTerm();
    while (this.peek()?.kind === "+" || this.peek()?.kind === "-") {
      const operator = this.consume().kind as "+" | "-";
      const right = this.parseTerm();
      left = { kind: "binop", operator, left, right };
    }
    return left;
  }

  private parseTerm(): Node {
    let left = this.parseFactor();
    while (this.peek()?.kind === "*" || this.peek()?.kind === "/") {
      const operator = this.consume().kind as "*" | "/";
      const right = this.parseFactor();
      left = { kind: "binop", operator, left, right };
    }
    return left;
  }

  private parseFactor(): Node {
    const tok = this.peek();
    if (!tok) throw new Error("unexpected end in factor");
    if (tok.kind === "number") {
      this.consume();
      return { kind: "num", value: tok.value as number };
    }
    if (tok.kind === "(") {
      this.consume();
      const inner = this.parseExpr();
      this.expect(")");
      return inner;
    }
    if (tok.kind === "ident") {
      const name = (tok.value as string) ?? "";
      // sum(...) — only function call we support
      if (name === "sum" && this.tokens[this.cursor + 1]?.kind === "(") {
        this.consume(); // ident
        this.expect("(");
        const arg = this.parseSumArg();
        this.expect(")");
        return { kind: "sum", arg };
      }
      this.consume();
      return { kind: "ident", name };
    }
    throw new Error(`unexpected token ${tok.kind} in factor`);
  }

  private parseSumArg(): SumArg {
    const factors: { table: string; col: string }[] = [];
    const operators: ("*" | "/")[] = [];
    factors.push(this.parseTableCol());
    while (this.peek()?.kind === "*" || this.peek()?.kind === "/") {
      const operator = this.consume().kind as "*" | "/";
      operators.push(operator);
      factors.push(this.parseTableCol());
    }
    return { factors, operators };
  }

  private parseTableCol(): { table: string; col: string } {
    const tableTok = this.expect("ident");
    this.expect("[]");
    this.expect(".");
    const colTok = this.expect("ident");
    return { table: tableTok.value as string, col: colTok.value as string };
  }
}

// ─── Evaluator ──────────────────────────────────────────────

function evaluate(node: Node, ctx: FormulaContext): number {
  if (node.kind === "num") return node.value;
  if (node.kind === "ident") {
    const raw = ctx.record[node.name];
    return toFiniteNumber(raw);
  }
  if (node.kind === "binop") {
    const left = evaluate(node.left, ctx);
    const right = evaluate(node.right, ctx);
    return applyBinop(node.operator, left, right);
  }
  if (node.kind === "sum") {
    return evaluateSum(node.arg, ctx);
  }
  // Exhaustive — TS narrows above branches but throw keeps runtime honest.
  throw new Error(`unknown node`);
}

function applyBinop(operator: "+" | "-" | "*" | "/", left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.NaN;
  if (operator === "+") return left + right;
  if (operator === "-") return left - right;
  if (operator === "*") return left * right;
  // operator === "/"
  if (right === 0) return Number.NaN;
  return left / right;
}

function evaluateSum(arg: SumArg, ctx: FormulaContext): number {
  if (arg.factors.length === 0) return 0;
  const tableName = arg.factors[0].table;
  // All factors must reference the SAME table (you can't multiply
  // a row from lineItems against a row from another table — the
  // semantics would be ambiguous). Reject mismatch.
  for (const factor of arg.factors) {
    if (factor.table !== tableName) return Number.NaN;
  }
  const rows = ctx.record[tableName];
  if (!Array.isArray(rows)) return 0;
  let total = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    let product = toFiniteNumber((row as Record<string, unknown>)[arg.factors[0].col]);
    if (!Number.isFinite(product)) return Number.NaN;
    for (let i = 1; i < arg.factors.length; i++) {
      const value = toFiniteNumber((row as Record<string, unknown>)[arg.factors[i].col]);
      if (!Number.isFinite(value)) return Number.NaN;
      product = applyBinop(arg.operators[i - 1], product, value);
    }
    total += product;
  }
  return total;
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === "string" && value.length > 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : Number.NaN;
  }
  return Number.NaN;
}
