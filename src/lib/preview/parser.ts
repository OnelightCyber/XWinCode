import { lex, SyntaxError, type StrChunk, type Token } from "./lexer";

export interface Arg {
  label: string | null;
  value: Expr;
}

export interface Trailing {
  label: string | null;
  fn: Closure;
}

export interface Closure {
  k: "closure";
  params: string[];
  body: Stmt[];
  pos: number;
}

export interface StrExpr {
  k: "str";
  parts: (string | { e: Expr; fmt: string | null })[];
  pos: number;
}

export type Expr =
  | { k: "num"; v: number; float: boolean; pos: number }
  | StrExpr
  | { k: "bool"; v: boolean; pos: number }
  | { k: "nil"; pos: number }
  | { k: "id"; name: string; pos: number }
  | { k: "member"; base: Expr | null; name: string; pos: number }
  | { k: "call"; callee: Expr; args: Arg[]; trailing: Trailing[]; pos: number }
  | { k: "sub"; base: Expr; args: Arg[]; pos: number }
  | Closure
  | { k: "bin"; op: string; l: Expr; r: Expr; pos: number }
  | { k: "un"; op: string; e: Expr; pos: number }
  | { k: "tern"; c: Expr; a: Expr; b: Expr; pos: number }
  | { k: "array"; items: Expr[]; pos: number }
  | { k: "dict"; entries: [Expr, Expr][]; pos: number }
  | { k: "keypath"; path: string[]; pos: number }
  | { k: "tuple"; items: Arg[]; pos: number }
  | { k: "ifexpr"; conds: Cond[]; a: Stmt[]; b: Stmt[] | null; pos: number };

export type Cond = { k: "expr"; e: Expr } | { k: "let"; name: string; e: Expr } | { k: "case"; pattern: Expr; e: Expr };

export interface SwitchCase {
  patterns: Expr[] | null;
  body: Stmt[];
}

export type Stmt =
  | { k: "expr"; e: Expr; pos: number; end?: number; file?: string }
  | { k: "decl"; names: string[]; init: Expr | null; type: string | null; pos: number }
  | { k: "assign"; target: Expr; op: string; value: Expr; pos: number }
  | { k: "if"; conds: Cond[]; then: Stmt[]; else: Stmt[] | null; pos: number }
  | { k: "guard"; conds: Cond[]; else: Stmt[]; pos: number }
  | { k: "for"; names: string[]; seq: Expr; body: Stmt[]; pos: number }
  | { k: "while"; cond: Expr; body: Stmt[]; pos: number }
  | { k: "switch"; subject: Expr; cases: SwitchCase[]; pos: number }
  | { k: "return"; e: Expr | null; pos: number }
  | { k: "break"; pos: number }
  | { k: "continue"; pos: number }
  | { k: "seq"; body: Stmt[]; pos: number };

export interface Property {
  name: string;
  attrs: string[];
  isStatic: boolean;
  mutable: boolean;
  type: string | null;
  init: Expr | null;
  getter: Stmt[] | null;
  pos: number;
}

export interface Param {
  label: string | null;
  name: string;
  type: string;
  def: Expr | null;
}

export interface Method {
  name: string;
  params: Param[];
  body: Stmt[];
  isStatic: boolean;
  pos: number;
}

export interface EnumCase {
  name: string;
  raw: Expr | null;
}

export interface TypeDecl {
  kind: "struct" | "class" | "enum" | "extension";
  name: string;
  inherits: string[];
  props: Property[];
  methods: Method[];
  cases: EnumCase[];
  inits: Method[];
  main: boolean;
  attrs: string[];
  pos: number;
}

export interface PreviewDecl {
  name: string | null;
  body: Stmt[];
  pos: number;
}

export interface FileAST {
  types: TypeDecl[];
  previews: PreviewDecl[];
  funcs: Method[];
  globals: Property[];
}

const MODIFIERS = new Set([
  "private",
  "fileprivate",
  "internal",
  "public",
  "open",
  "static",
  "final",
  "lazy",
  "mutating",
  "nonmutating",
  "override",
  "weak",
  "unowned",
  "dynamic",
  "nonisolated",
  "required",
  "convenience",
  "indirect",
  "isolated",
  "consuming",
  "borrowing",
]);

const BINARY: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "===": 3,
  "!==": 3,
  "<": 3,
  ">": 3,
  "<=": 3,
  ">=": 3,
  "??": 4,
  "...": 5,
  "..<": 5,
  "+": 6,
  "-": 6,
  "|": 6,
  "^": 6,
  "*": 7,
  "/": 7,
  "%": 7,
  "&": 7,
  "&+": 6,
  "&-": 6,
  "&*": 7,
  "<<": 8,
  ">>": 8,
};

const ASSIGN = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&+=", "&-=", "&*=", "<<=", ">>=", "^=", "|=", "&="]);

const MAX_DEPTH = 400;
const TOO_DEEP = "This code is nested too deeply to preview";

const TOP_STARTS = new Set(["struct", "class", "enum", "extension", "actor", "func", "import", "protocol", "let", "var", "typealias"]);

const MEMBER_STARTS = new Set([
  "var",
  "let",
  "func",
  "init",
  "case",
  "struct",
  "class",
  "enum",
  "extension",
  "private",
  "fileprivate",
  "public",
  "internal",
  "static",
  "subscript",
  "deinit",
  "typealias",
]);

class Parser {
  private i = 0;
  errors: SyntaxError[] = [];
  nested: TypeDecl[] = [];

  constructor(
    private t: Token[],
    private src: string,
    private fileId?: string,
    private depth = 0,
  ) {}

  private nest<T>(run: () => T): T {
    if (this.depth >= MAX_DEPTH) throw new SyntaxError(TOO_DEEP, this.tok.pos);
    this.depth++;
    try {
      return run();
    } finally {
      this.depth--;
    }
  }

  private get tok(): Token {
    return this.t[this.i];
  }

  private kindIs(kind: Token["kind"]): boolean {
    return this.t[this.i].kind === kind;
  }

  private atEnd(): boolean {
    return this.t[this.i].kind === "eof";
  }

  private peek(n = 1): Token {
    return this.t[Math.min(this.i + n, this.t.length - 1)];
  }

  private next(): Token {
    const tok = this.t[this.i];
    if (this.i < this.t.length - 1) this.i++;
    return tok;
  }

  private is(value: string, kind?: Token["kind"]): boolean {
    const tok = this.tok;
    return tok.value === value && (kind ? tok.kind === kind : tok.kind === "punct" || tok.kind === "op" || tok.kind === "id");
  }

  private isPunct(value: string): boolean {
    return this.kindIs("punct") && this.tok.value === value;
  }

  private isKw(value: string): boolean {
    return this.kindIs("id") && this.tok.value === value;
  }

  private eat(value: string): boolean {
    if (this.is(value)) {
      this.next();
      return true;
    }
    return false;
  }

  private expect(value: string): Token {
    if (!this.is(value)) throw new SyntaxError(`Expected '${value}'`, this.tok.pos);
    return this.next();
  }

  private ident(): string {
    const tok = this.tok;
    if (tok.kind !== "id") throw new SyntaxError("Expected a name", tok.pos);
    this.next();
    return tok.value;
  }

  private skipBalanced(open: string, close: string) {
    let depth = 0;
    do {
      if (this.tok.kind === "eof") return;
      if (this.isPunct(open) || (open === "<" && this.tok.value === "<")) depth++;
      else if (this.isPunct(close) || (close === ">" && this.tok.value === ">")) depth--;
      else if (close === ">" && this.tok.value === ">>") depth -= 2;
      this.next();
    } while (depth > 0);
  }

  private skipAttrArgs(): string {
    if (!this.isPunct("(") || this.tok.space) return "";
    const start = this.tok.pos;
    this.skipBalanced("(", ")");
    return this.src.slice(start, this.t[this.i - 1].end);
  }

  private typeText(stop: (tok: Token) => boolean): string {
    const start = this.tok.pos;
    let depth = 0;
    let end = start;
    while (!this.atEnd()) {
      const tok = this.tok;
      if (depth === 0 && stop(tok)) break;
      if (tok.value === "<" || tok.value === "(" || tok.value === "[") depth++;
      else if (tok.value === ">" || tok.value === ")" || tok.value === "]") {
        if (depth === 0) break;
        depth--;
      } else if (tok.value === ">>") {
        if (depth < 2) break;
        depth -= 2;
      } else if (tok.value === "->" && depth === 0) {
        end = tok.end;
        this.next();
        continue;
      }
      end = tok.end;
      this.next();
      if (depth === 0 && this.tok.nl && !["?", "!", "->", "&", "."].includes(this.tok.value)) break;
    }
    return this.src.slice(start, end).trim();
  }

  file(): FileAST {
    const ast: FileAST = { types: [], previews: [], funcs: [], globals: [] };
    while (!this.atEnd()) {
      const before = this.i;
      try {
        this.topLevel(ast);
      } catch (e) {
        if (e instanceof RangeError) this.errors.push(new SyntaxError(TOO_DEEP, this.t[before]?.pos ?? 0));
        else if (e instanceof SyntaxError) this.errors.push(e);
        else throw e;
        this.skipDecl(before, TOP_STARTS);
      }
    }
    ast.types.push(...this.nested);
    return ast;
  }

  private skipDecl(start: number, starts: Set<string>) {
    this.i = start;
    let depth = 0;
    let first = true;
    while (!this.atEnd()) {
      const tok = this.tok;
      if (!first && depth === 0 && tok.nl && (tok.kind === "attr" || tok.kind === "pound" || starts.has(tok.value))) return;
      if (tok.kind === "punct" && tok.value === "{") depth++;
      else if (tok.kind === "punct" && tok.value === "}") {
        if (depth === 0) return;
        depth--;
      }
      first = false;
      this.next();
    }
  }

  private topLevel(ast: FileAST) {
    const attrs: string[] = [];
    while (this.kindIs("attr")) {
      const name = this.next().value;
      attrs.push(name + this.skipAttrArgs());
    }
    while (this.kindIs("id") && MODIFIERS.has(this.tok.value)) this.next();
    const tok = this.tok;
    if (tok.kind === "pound") {
      if (tok.value === "Preview") {
        this.next();
        let name: string | null = null;
        if (this.isPunct("(")) {
          const args = this.args();
          const first = args.find((a) => a.label === null);
          if (first?.value.k === "str") name = first.value.parts.filter((p) => typeof p === "string").join("");
        }
        const body = this.block();
        ast.previews.push({ name, body, pos: tok.pos });
        return;
      }
      this.next();
      if (this.isPunct("(")) this.skipBalanced("(", ")");
      return;
    }
    if (tok.kind !== "id") {
      this.next();
      return;
    }
    switch (tok.value) {
      case "import":
        this.next();
        while (!this.tok.nl && !this.atEnd()) this.next();
        return;
      case "struct":
      case "class":
      case "actor":
      case "enum":
      case "extension":
        ast.types.push(this.typeDecl(attrs));
        return;
      case "protocol":
        this.next();
        while (!this.isPunct("{") && !this.atEnd()) this.next();
        this.skipBalanced("{", "}");
        return;
      case "typealias":
        this.next();
        while (!this.tok.nl && !this.atEnd()) this.next();
        return;
      case "func":
        ast.funcs.push(this.method(false));
        return;
      case "let":
      case "var":
        ast.globals.push(this.property(attrs, false));
        return;
      default:
        this.next();
    }
  }

  private typeDecl(attrs: string[]): TypeDecl {
    return this.nest(() => this.typeDeclBody(attrs));
  }

  private typeDeclBody(attrs: string[]): TypeDecl {
    const kw = this.next();
    const kind = (kw.value === "actor" ? "class" : kw.value) as TypeDecl["kind"];
    let name = this.ident();
    while (this.isPunct(".") && this.peek().kind === "id") {
      this.next();
      name = this.ident();
    }
    if (this.tok.value === "<") this.skipBalanced("<", ">");
    const inherits: string[] = [];
    if (this.eat(":")) {
      do {
        inherits.push(this.typeText((t) => t.value === "," || t.value === "{" || t.value === "where"));
      } while (this.eat(","));
    }
    if (this.isKw("where")) while (!this.isPunct("{") && !this.atEnd()) this.next();
    const decl: TypeDecl = {
      kind,
      name,
      inherits,
      props: [],
      methods: [],
      cases: [],
      inits: [],
      main: attrs.includes("main"),
      attrs,
      pos: kw.pos,
    };
    this.expect("{");
    while (!this.isPunct("}") && !this.atEnd()) {
      const before = this.i;
      try {
        this.member(decl);
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        this.errors.push(e);
        this.skipDecl(before, MEMBER_STARTS);
        continue;
      }
      if (this.i === before) this.next();
    }
    this.expect("}");
    return decl;
  }

  private member(decl: TypeDecl) {
    const attrs: string[] = [];
    let isStatic = false;
    for (;;) {
      if (this.kindIs("attr")) {
        const name = this.next().value;
        attrs.push(name + this.skipAttrArgs());
      } else if (this.kindIs("id") && MODIFIERS.has(this.tok.value)) {
        if (this.tok.value === "static") isStatic = true;
        this.next();
        if (this.isPunct("(")) this.skipBalanced("(", ")");
      } else if (this.isKw("class") && ["var", "func", "let"].includes(this.peek().value)) {
        isStatic = true;
        this.next();
      } else break;
    }
    const tok = this.tok;
    if (tok.kind === "pound") {
      this.next();
      if (this.isPunct("(")) this.skipBalanced("(", ")");
      return;
    }
    if (tok.kind !== "id") {
      this.next();
      return;
    }
    switch (tok.value) {
      case "var":
      case "let":
        decl.props.push(this.property(attrs, isStatic));
        return;
      case "func":
        decl.methods.push(this.method(isStatic));
        return;
      case "init": {
        this.next();
        if (this.is("?") || this.is("!")) this.next();
        const params = this.params();
        if (this.isKw("throws") || this.isKw("async")) this.next();
        const body = this.isPunct("{") ? this.block() : [];
        decl.inits.push({ name: "init", params, body, isStatic: false, pos: tok.pos });
        return;
      }
      case "case":
        this.next();
        do {
          const name = this.ident();
          if (this.isPunct("(")) this.skipBalanced("(", ")");
          let raw: Expr | null = null;
          if (this.eat("=")) raw = this.expr();
          decl.cases.push({ name, raw });
        } while (this.eat(","));
        return;
      case "struct":
      case "class":
      case "enum":
      case "actor":
      case "extension": {
        this.nested.push(this.typeDecl(attrs));
        return;
      }
      case "deinit":
      case "subscript":
      case "typealias":
      case "associatedtype":
        this.next();
        while (!this.isPunct("{") && !this.tok.nl && !this.atEnd()) this.next();
        if (this.isPunct("{")) this.skipBalanced("{", "}");
        return;
      default:
        this.next();
    }
  }

  private property(attrs: string[], isStatic: boolean): Property {
    const kw = this.next();
    let name: string;
    if (this.isPunct("(")) {
      this.skipBalanced("(", ")");
      name = "_";
    } else name = this.ident();
    let type: string | null = null;
    if (this.eat(":")) type = this.typeText((t) => t.value === "=" || t.value === "{" || t.value === ",");
    let init: Expr | null = null;
    let getter: Stmt[] | null = null;
    if (this.eat("=")) init = this.expr();
    if (this.isPunct("{") && (!this.tok.nl || init === null)) {
      if (init === null) getter = this.accessorBlock();
      else this.skipBalanced("{", "}");
    }
    while (this.eat(",")) {
      this.ident();
      if (this.eat(":")) this.typeText((t) => t.value === "=" || t.value === ",");
      if (this.eat("=")) this.expr();
    }
    return { name, attrs, isStatic, mutable: kw.value === "var", type, init, getter, pos: kw.pos };
  }

  private accessorBlock(): Stmt[] {
    const save = this.i;
    this.expect("{");
    if (this.isKw("get") || this.isKw("set") || this.isKw("willSet") || this.isKw("didSet")) {
      let getter: Stmt[] = [];
      while (!this.isPunct("}") && !this.atEnd()) {
        const which = this.ident();
        if (this.isPunct("(")) this.skipBalanced("(", ")");
        if (which === "get") {
          if (this.isKw("async") || this.isKw("throws")) this.next();
          getter = this.block();
        } else if (this.isPunct("{")) this.skipBalanced("{", "}");
      }
      this.expect("}");
      return getter;
    }
    this.i = save;
    return this.block();
  }

  private params(): Param[] {
    const out: Param[] = [];
    this.expect("(");
    while (!this.isPunct(")") && !this.atEnd()) {
      while (this.kindIs("attr")) this.next();
      const first = this.ident();
      let label: string | null = first;
      let name = first;
      if (this.kindIs("id")) {
        name = this.ident();
        label = first === "_" ? null : first;
      }
      this.expect(":");
      while (this.kindIs("attr") || this.isKw("inout") || this.isKw("sending")) this.next();
      const type = this.typeText((t) => t.value === "," || t.value === ")" || t.value === "=");
      let def: Expr | null = null;
      if (this.eat("=")) def = this.expr();
      out.push({ label, name, type, def });
      if (!this.eat(",")) break;
    }
    this.expect(")");
    return out;
  }

  private method(isStatic: boolean): Method {
    const kw = this.next();
    const name = this.kindIs("id") ? this.ident() : this.next().value;
    if (this.tok.value === "<") this.skipBalanced("<", ">");
    const params = this.params();
    while (this.isKw("async") || this.isKw("throws") || this.isKw("rethrows")) this.next();
    if (this.eat("->")) this.typeText((t) => t.value === "{" || t.value === "where");
    if (this.isKw("where")) while (!this.isPunct("{") && !this.atEnd()) this.next();
    const body = this.isPunct("{") ? this.block() : [];
    return { name, params, body, isStatic, pos: kw.pos };
  }

  block(): Stmt[] {
    this.expect("{");
    const body = this.stmts();
    this.expect("}");
    return body;
  }

  private stmts(): Stmt[] {
    const out: Stmt[] = [];
    while (!this.isPunct("}") && !this.atEnd()) {
      if (this.eat(";")) continue;
      if (this.kindIs("pound")) {
        this.next();
        while (!this.tok.nl && !this.atEnd()) this.next();
        continue;
      }
      const before = this.i;
      out.push(this.stmt());
      if (this.i === before) this.next();
    }
    return out;
  }

  private stmt(): Stmt {
    return this.nest(() => this.stmtBody());
  }

  private stmtBody(): Stmt {
    const tok = this.tok;
    if (tok.kind === "attr") {
      this.next();
      this.skipAttrArgs();
      return this.stmt();
    }
    if (tok.kind === "id") {
      switch (tok.value) {
        case "let":
        case "var": {
          this.next();
          let names: string[];
          if (this.isPunct("(")) {
            this.next();
            names = [];
            while (!this.isPunct(")") && !this.atEnd()) {
              names.push(this.ident());
              this.eat(",");
            }
            this.expect(")");
          } else names = [this.ident()];
          let type: string | null = null;
          if (this.eat(":")) type = this.typeText((t) => t.value === "=" || t.value === ";" || t.value === ",");
          const init = this.eat("=") ? this.expr() : null;
          const first: Stmt = { k: "decl", names, init, type, pos: tok.pos };
          if (!this.isPunct(",")) return first;
          const body: Stmt[] = [first];
          while (this.eat(",")) {
            const name = this.ident();
            let more: string | null = null;
            if (this.eat(":")) more = this.typeText((t) => t.value === "=" || t.value === ";" || t.value === ",");
            body.push({ k: "decl", names: [name], init: this.eat("=") ? this.expr() : null, type: more, pos: this.tok.pos });
          }
          return { k: "seq", body, pos: tok.pos };
        }
        case "if": {
          this.next();
          const conds = this.conds();
          const then = this.block();
          let els: Stmt[] | null = null;
          if (this.isKw("else")) {
            this.next();
            els = this.isKw("if") ? [this.stmt()] : this.block();
          }
          return { k: "if", conds, then, else: els, pos: tok.pos };
        }
        case "guard": {
          this.next();
          const conds = this.conds();
          if (!this.isKw("else")) throw new SyntaxError("Expected 'else'", this.tok.pos);
          this.next();
          return { k: "guard", conds, else: this.block(), pos: tok.pos };
        }
        case "for": {
          this.next();
          if (this.isKw("case")) this.next();
          const names: string[] = [];
          if (this.isPunct("(")) {
            this.next();
            while (!this.isPunct(")") && !this.atEnd()) {
              names.push(this.ident());
              this.eat(",");
            }
            this.expect(")");
          } else names.push(this.ident());
          if (this.eat(":")) this.typeText((t) => t.value === "in");
          if (!this.isKw("in")) throw new SyntaxError("Expected 'in'", this.tok.pos);
          this.next();
          const seq = this.expr(true);
          if (this.isKw("where")) {
            this.next();
            this.expr(true);
          }
          return { k: "for", names, seq, body: this.block(), pos: tok.pos };
        }
        case "while": {
          this.next();
          const cond = this.expr(true);
          return { k: "while", cond, body: this.block(), pos: tok.pos };
        }
        case "repeat": {
          this.next();
          const body = this.block();
          if (this.isKw("while")) {
            this.next();
            const cond = this.expr();
            return { k: "while", cond, body, pos: tok.pos };
          }
          return { k: "if", conds: [{ k: "expr", e: { k: "bool", v: true, pos: tok.pos } }], then: body, else: null, pos: tok.pos };
        }
        case "switch":
          return this.switchStmt();
        case "return": {
          this.next();
          const e = this.tok.nl || this.isPunct("}") || this.isPunct(";") ? null : this.expr();
          return { k: "return", e, pos: tok.pos };
        }
        case "break":
          this.next();
          return { k: "break", pos: tok.pos };
        case "continue":
          this.next();
          return { k: "continue", pos: tok.pos };
        case "fallthrough":
          this.next();
          return { k: "break", pos: tok.pos };
        case "do": {
          this.next();
          const body = this.block();
          while (this.isKw("catch")) {
            this.next();
            while (!this.isPunct("{") && !this.atEnd()) this.next();
            this.block();
          }
          return { k: "if", conds: [{ k: "expr", e: { k: "bool", v: true, pos: tok.pos } }], then: body, else: null, pos: tok.pos };
        }
        case "defer":
          this.next();
          this.block();
          return { k: "expr", e: { k: "nil", pos: tok.pos }, pos: tok.pos };
        case "func": {
          const m = this.method(false);
          return {
            k: "decl",
            names: [m.name],
            init: { k: "closure", params: m.params.map((p) => p.name), body: m.body, pos: m.pos },
            type: null,
            pos: m.pos,
          };
        }
      }
    }
    const e = this.expr();
    if ((this.kindIs("op") || this.kindIs("punct")) && ASSIGN.has(this.tok.value)) {
      const op = this.next().value;
      const value = this.expr();
      return { k: "assign", target: e, op, value, pos: tok.pos };
    }
    return { k: "expr", e, pos: tok.pos, end: this.t[this.i - 1]?.end ?? tok.end, file: this.fileId };
  }

  private switchStmt(): Stmt {
    const tok = this.next();
    const subject = this.expr(true);
    this.expect("{");
    const cases: SwitchCase[] = [];
    while (!this.isPunct("}") && !this.atEnd()) {
      let patterns: Expr[] | null;
      while (this.kindIs("attr")) this.next();
      if (this.isKw("default")) {
        this.next();
        patterns = null;
      } else {
        if (!this.isKw("case")) throw new SyntaxError("Expected 'case'", this.tok.pos);
        this.next();
        patterns = [];
        do {
          if (this.isKw("let") || this.isKw("var")) this.next();
          patterns.push(this.expr(true));
          if (this.isKw("where")) {
            this.next();
            this.expr(true);
          }
        } while (this.eat(","));
      }
      this.expect(":");
      const body: Stmt[] = [];
      while (!this.isKw("case") && !this.isKw("default") && !this.isPunct("}") && !this.atEnd() && !(this.kindIs("attr") && this.peek().value === "default")) {
        if (this.eat(";")) continue;
        const before = this.i;
        body.push(this.stmt());
        if (this.i === before) this.next();
      }
      cases.push({ patterns, body });
    }
    this.expect("}");
    return { k: "switch", subject, cases, pos: tok.pos };
  }

  private conds(): Cond[] {
    const out: Cond[] = [];
    do {
      if (this.isKw("let") || this.isKw("var")) {
        this.next();
        let name = "_";
        if (this.isPunct("(")) this.skipBalanced("(", ")");
        else name = this.ident();
        if (this.eat(":")) this.typeText((t) => t.value === "=" || t.value === "," || t.value === "{");
        const e: Expr = this.eat("=") ? this.expr(true) : { k: "id", name, pos: this.tok.pos };
        out.push({ k: "let", name, e });
      } else if (this.isKw("case")) {
        this.next();
        const pattern = this.expr(true);
        this.expect("=");
        out.push({ k: "case", pattern, e: this.expr(true) });
      } else out.push({ k: "expr", e: this.expr(true) });
    } while (this.eat(","));
    return out;
  }

  expr(noTrailing = false): Expr {
    return this.nest(() => this.exprBody(noTrailing));
  }

  private exprBody(noTrailing: boolean): Expr {
    const c = this.binary(0, noTrailing);
    if (this.is("?", "op") && this.tok.space) {
      this.next();
      const a = this.expr(noTrailing);
      this.expect(":");
      const b = this.expr(noTrailing);
      return { k: "tern", c, a, b, pos: c.pos };
    }
    return c;
  }

  private binary(min: number, noTrailing: boolean): Expr {
    let left = this.unary(noTrailing);
    for (;;) {
      const tok = this.tok;
      if (tok.kind === "id" && (tok.value === "as" || tok.value === "is")) {
        this.next();
        if (this.is("?") || this.is("!")) this.next();
        const type = this.castType();
        if (tok.value === "is") left = { k: "call", callee: { k: "id", name: "__is", pos: tok.pos }, args: [{ label: null, value: left }, { label: null, value: { k: "str", parts: [type], pos: tok.pos } }], trailing: [], pos: tok.pos };
        continue;
      }
      if (tok.kind !== "op") break;
      const prec = BINARY[tok.value];
      if (prec === undefined || prec < min) break;
      if (tok.nl && tok.value !== "&&" && tok.value !== "||" && tok.value !== "??" && tok.value !== "+") break;
      this.next();
      const right = this.binary(prec + 1, noTrailing);
      left = { k: "bin", op: tok.value, l: left, r: right, pos: tok.pos };
    }
    return left;
  }

  private skipGenericArgs() {
    const save = this.i;
    let depth = 0;
    while (!this.atEnd()) {
      const v = this.tok.value;
      if (v === "<") depth++;
      else if (v === ">") depth--;
      else if (v === ">>") depth -= 2;
      else if (!(this.kindIs("id") || [",", ".", "[", "]", "?", ":", "(", ")", "&"].includes(v))) break;
      this.next();
      if (depth <= 0) {
        if (depth === 0 && (this.isPunct("(") || this.isPunct(".") || this.isPunct("{") || this.isPunct(")") || this.isPunct(","))) return;
        break;
      }
    }
    this.i = save;
  }

  private castType(): string {
    const start = this.tok.pos;
    let end = start;
    if (this.isPunct("[") || this.isPunct("(")) {
      const open = this.tok.value;
      this.skipBalanced(open, open === "[" ? "]" : ")");
      end = this.t[this.i - 1].end;
    } else {
      if (this.isKw("any") || this.isKw("some")) this.next();
      end = this.next().end;
      while (this.isPunct(".") && this.peek().kind === "id") {
        this.next();
        end = this.next().end;
      }
      if (this.tok.value === "<" && !this.tok.space) {
        this.skipBalanced("<", ">");
        end = this.t[this.i - 1].end;
      }
    }
    while ((this.is("?") || this.is("!")) && !this.tok.space) end = this.next().end;
    return this.src.slice(start, end);
  }

  private unary(noTrailing: boolean): Expr {
    return this.nest(() => this.unaryBody(noTrailing));
  }

  private unaryBody(noTrailing: boolean): Expr {
    const tok = this.tok;
    if (tok.kind === "op" && BINARY[tok.value] !== undefined && (this.peek().value === ")" || this.peek().value === ",")) {
      this.next();
      return { k: "id", name: tok.value, pos: tok.pos };
    }
    if (tok.kind === "op" && ["!", "-", "+", "~", "&", "..."].includes(tok.value)) {
      this.next();
      const e = this.unary(noTrailing);
      if (tok.value === "&" || tok.value === "+") return e;
      if (tok.value === "...") return { k: "bin", op: "...", l: { k: "num", v: 0, float: false, pos: tok.pos }, r: e, pos: tok.pos };
      return { k: "un", op: tok.value, e, pos: tok.pos };
    }
    if (this.isKw("try") || this.isKw("await")) {
      this.next();
      if (this.is("?") || this.is("!")) this.next();
      return this.unary(noTrailing);
    }
    return this.postfix(this.primary(noTrailing), noTrailing);
  }

  private primary(noTrailing: boolean): Expr {
    const tok = this.tok;
    switch (tok.kind) {
      case "num": {
        this.next();
        const v = tok.value.startsWith("0x")
          ? parseInt(tok.value.slice(2), 16)
          : tok.value.startsWith("0b")
            ? parseInt(tok.value.slice(2), 2)
            : tok.value.startsWith("0o")
              ? parseInt(tok.value.slice(2), 8)
              : Number(tok.value);
        return { k: "num", v, float: !!tok.float, pos: tok.pos };
      }
      case "str":
        this.next();
        return this.stringExpr(tok);
      case "pound": {
        this.next();
        if (this.isPunct("(")) this.skipBalanced("(", ")");
        return { k: "nil", pos: tok.pos };
      }
      case "id": {
        if (tok.value === "true" || tok.value === "false") {
          this.next();
          return { k: "bool", v: tok.value === "true", pos: tok.pos };
        }
        if (tok.value === "nil") {
          this.next();
          return { k: "nil", pos: tok.pos };
        }
        if (tok.value === "if" || tok.value === "switch") return this.ifExpr();
        this.next();
        if (/^[A-Z]/.test(tok.value) && this.tok.value === "<" && !this.tok.space) this.skipGenericArgs();
        return { k: "id", name: tok.value, pos: tok.pos };
      }
      case "punct": {
        if (tok.value === ".") {
          this.next();
          const name = this.kindIs("id") || this.kindIs("num") ? this.next().value : "";
          return { k: "member", base: null, name, pos: tok.pos };
        }
        if (tok.value === "(") {
          const args = this.args();
          if (args.length === 1 && args[0].label === null) return args[0].value;
          return { k: "tuple", items: args, pos: tok.pos };
        }
        if (tok.value === "[") return this.arrayExpr();
        if (tok.value === "{") return this.closure();
        if (tok.value === "\\") {
          this.next();
          const path: string[] = [];
          if (this.kindIs("id")) path.push("@" + this.next().value);
          while (this.isPunct(".") || this.is("?")) {
            this.next();
            if (this.kindIs("id") || this.kindIs("num")) path.push(this.next().value);
          }
          return { k: "keypath", path, pos: tok.pos };
        }
        break;
      }
    }
    if (tok.kind === "op" && BINARY[tok.value] !== undefined && (this.peek().value === ")" || this.peek().value === ",")) {
      this.next();
      return { k: "id", name: tok.value, pos: tok.pos };
    }
    void noTrailing;
    throw new SyntaxError(tok.kind === "eof" ? "Unexpected end of file" : `Unexpected '${tok.value}'`, tok.pos);
  }

  private ifExpr(): Expr {
    const tok = this.tok;
    if (tok.value === "switch") {
      const s = this.switchStmt();
      return { k: "ifexpr", conds: [{ k: "expr", e: { k: "bool", v: true, pos: tok.pos } }], a: [s], b: null, pos: tok.pos };
    }
    this.next();
    const conds = this.conds();
    const a = this.block();
    let b: Stmt[] | null = null;
    if (this.isKw("else")) {
      this.next();
      b = this.isKw("if") ? [{ k: "expr", e: this.ifExpr(), pos: this.tok.pos }] : this.block();
    }
    return { k: "ifexpr", conds, a, b, pos: tok.pos };
  }

  private stringExpr(tok: Token): StrExpr {
    const parts: StrExpr["parts"] = [];
    for (const p of tok.parts ?? []) {
      if (typeof p === "string") {
        parts.push(p);
        continue;
      }
      parts.push(this.interpolation(p));
    }
    return { k: "str", parts, pos: tok.pos };
  }

  private interpolation(chunk: StrChunk): { e: Expr; fmt: string | null } {
    const sub = new Parser(lex(this.src.slice(chunk.pos, chunk.pos + chunk.code.length), chunk.pos), this.src, this.fileId, this.depth);
    const value = sub.expr();
    let fmt: string | null = null;
    while (sub.eat(",")) {
      const label = sub.tok.kind === "id" && sub.peek().value === ":" ? sub.ident() : null;
      if (label) sub.expect(":");
      const arg = sub.expr();
      if (label === "specifier" && arg.k === "str") fmt = arg.parts.filter((x) => typeof x === "string").join("");
    }
    return { e: value, fmt };
  }

  private arrayExpr(): Expr {
    const tok = this.expect("[");
    if (this.eat(":")) {
      this.expect("]");
      return { k: "dict", entries: [], pos: tok.pos };
    }
    const items: Expr[] = [];
    const entries: [Expr, Expr][] = [];
    while (!this.isPunct("]") && !this.atEnd()) {
      const e = this.expr();
      if (this.eat(":")) entries.push([e, this.expr()]);
      else items.push(e);
      if (!this.eat(",")) break;
    }
    this.expect("]");
    if (entries.length) return { k: "dict", entries, pos: tok.pos };
    return { k: "array", items, pos: tok.pos };
  }

  private closure(): Closure {
    const tok = this.expect("{");
    const params = this.closureParams();
    const body = this.stmts();
    this.expect("}");
    return { k: "closure", params, body, pos: tok.pos };
  }

  private closureParams(): string[] {
    const save = this.i;
    const params: string[] = [];
    while (this.kindIs("attr")) this.next();
    if (this.isPunct("[")) this.skipBalanced("[", "]");
    if (this.isPunct("(")) {
      this.next();
      while (!this.isPunct(")") && !this.atEnd()) {
        if (!this.kindIs("id")) {
          this.i = save;
          return [];
        }
        params.push(this.next().value);
        if (this.eat(":")) this.typeText((t) => t.value === "," || t.value === ")");
        if (!this.eat(",")) break;
      }
      if (!this.eat(")")) {
        this.i = save;
        return [];
      }
    } else {
      while (this.kindIs("id") && this.tok.value !== "in") {
        params.push(this.next().value);
        if (!this.eat(",")) break;
      }
    }
    if (this.eat("->")) this.typeText((t) => t.value === "in");
    if (this.isKw("in") && (params.length || this.i > save)) {
      this.next();
      return params;
    }
    this.i = save;
    return [];
  }

  private args(): Arg[] {
    this.expect("(");
    const out: Arg[] = [];
    while (!this.isPunct(")") && !this.atEnd()) {
      let label: string | null = null;
      if (this.kindIs("id") && this.peek().kind === "punct" && this.peek().value === ":") {
        label = this.next().value;
        this.next();
      }
      if (this.isKw("let") || this.isKw("var")) this.next();
      out.push({ label, value: this.expr() });
      if (!this.eat(",")) break;
    }
    this.expect(")");
    return out;
  }

  private postfix(e: Expr, noTrailing: boolean): Expr {
    for (;;) {
      const tok = this.tok;
      if (tok.kind === "punct" && tok.value === ".") {
        this.next();
        if (!this.kindIs("id") && !this.kindIs("num")) throw new SyntaxError("Expected a member name", this.tok.pos);
        const name = this.next().value;
        e = { k: "member", base: e, name, pos: tok.pos };
        continue;
      }
      if (tok.kind === "punct" && tok.value === "(" && !tok.nl) {
        const args = this.args();
        e = { k: "call", callee: e, args, trailing: [], pos: e.pos };
        e = this.trailing(e, noTrailing);
        continue;
      }
      if (tok.kind === "punct" && tok.value === "[" && !tok.space) {
        this.next();
        const args: Arg[] = [];
        while (!this.isPunct("]") && !this.atEnd()) {
          let label: string | null = null;
          if (this.kindIs("id") && this.peek().value === ":") {
            label = this.next().value;
            this.next();
          }
          args.push({ label, value: this.expr() });
          if (!this.eat(",")) break;
        }
        this.expect("]");
        e = { k: "sub", base: e, args, pos: tok.pos };
        continue;
      }
      if (tok.kind === "punct" && tok.value === "{" && !tok.nl && !noTrailing) {
        e = this.trailing({ k: "call", callee: e, args: [], trailing: [], pos: e.pos }, noTrailing);
        continue;
      }
      if (tok.kind === "op" && (tok.value === "!" || tok.value === "?") && !tok.space) {
        this.next();
        continue;
      }
      break;
    }
    return e;
  }

  private trailing(call: Extract<Expr, { k: "call" }>, noTrailing: boolean): Expr {
    if (noTrailing) return call;
    if (this.isPunct("{") && !this.tok.nl) {
      call.trailing.push({ label: null, fn: this.closure() });
      while (this.kindIs("id") && this.peek().value === ":" && this.peek(2).value === "{" && !this.peek(2).nl) {
        const label = this.next().value;
        this.next();
        call.trailing.push({ label, fn: this.closure() });
      }
    }
    return call;
  }
}

export interface ParseResult {
  ast: FileAST;
  errors: { message: string; pos: number }[];
}

export function parseSwift(src: string, file?: string): ParseResult {
  const errors: SyntaxError[] = [];
  let tokens: Token[];
  try {
    tokens = lex(src);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { ast: { types: [], previews: [], funcs: [], globals: [] }, errors: [{ message: e.message, pos: e.pos }] };
    }
    throw e;
  }
  const parser = new Parser(tokens, src, file);
  const ast = parser.file();
  errors.push(...parser.errors);
  return { ast, errors: errors.map((e) => ({ message: e.message, pos: e.pos })) };
}
