/**
 * Tiny boolean-expression evaluator for the screener page custom query box.
 *
 * Supported grammar (case-insensitive keywords):
 *
 *   expr        := orExpr
 *   orExpr      := andExpr (OR andExpr)*
 *   andExpr     := comparison (AND comparison)*
 *   comparison  := IDENT OP VALUE
 *
 * VALUE accepts:
 *   - numeric literal (1, 1.5, 1e9)
 *   - numeric with %  → divided by 100  (15%  → 0.15)
 *   - numeric with K/M/B/T suffix → 1e3/1e6/1e9/1e12 (10B → 10_000_000_000)
 *   - bare word / quoted string for textual fields (country, sector, tag)
 *
 * IDENT must be one of the keys in FIELD_MAP. Two synthetic fields exist:
 *   - country  (matches r.country, equality only)
 *   - sector   (matches r.sector,  equality only)
 *   - tag      (true when r.tags contains the value)
 *
 * Precedence: AND binds tighter than OR (no parens supported in v1).
 *   "a > 1 OR b > 2 AND c > 3"   parses as   "a > 1 OR (b > 2 AND c > 3)"
 */

import type { ScreenerRow } from './types';

type Op = '>' | '>=' | '<' | '<=' | '=' | '!=';

type Comparison = {
  kind: 'cmp';
  field: string;
  op: Op;
  value: number | string;
};

type BoolNode =
  | Comparison
  | { kind: 'and'; left: BoolNode; right: BoolNode }
  | { kind: 'or';  left: BoolNode; right: BoolNode };

export type Query = BoolNode;

// Map of supported numeric fields → ScreenerRow keys.
// Anything else falls through to the text-field path (country/sector/tag).
const FIELD_MAP: Record<string, keyof ScreenerRow> = {
  marketcap:        'marketCap',
  pe:               'pe',
  pb:               'pb',
  roe:              'roe',
  roic:             'roic',
  debttoequity:     'debtToEquity',
  operatingmargin:  'operatingMargin',
  netmargin:        'netMargin',
  grossmargin:      'grossMargin',
  fcfyield:         'fcfYield',
  dividendyield:    'dividendYield',
  revenuecagr:      'revenueCagr',
  fcfcagr:          'fcfCagr',
  eps:              'eps',
  revenue:          'revenue',
  netincome:        'netIncome',
  profit:           'netIncome',
  fcf:              'fcf',
  price:            'price',
};

const TEXT_FIELDS = new Set(['country', 'sector', 'tag']);

// ────────────────────────────────────────────────────────────────────────────
// Tokeniser

type Tok =
  | { t: 'word'; v: string }
  | { t: 'num';  v: number }
  | { t: 'op';   v: Op }
  | { t: 'and' }
  | { t: 'or' };

function tokenise(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    // whitespace
    if (/\s/.test(c)) { i++; continue; }

    // multi-char operators must come before single-char
    if (src.startsWith('>=', i)) { out.push({ t: 'op', v: '>=' }); i += 2; continue; }
    if (src.startsWith('<=', i)) { out.push({ t: 'op', v: '<=' }); i += 2; continue; }
    if (src.startsWith('!=', i)) { out.push({ t: 'op', v: '!=' }); i += 2; continue; }
    if (c === '>') { out.push({ t: 'op', v: '>' }); i++; continue; }
    if (c === '<') { out.push({ t: 'op', v: '<' }); i++; continue; }
    if (c === '=') { out.push({ t: 'op', v: '=' }); i++; continue; }

    // quoted string (value side)
    if (c === '"' || c === "'") {
      const quote = c; i++;
      let s = '';
      while (i < n && src[i] !== quote) { s += src[i++]; }
      if (i >= n) throw new Error('Unclosed quote in query');
      i++; // closing
      out.push({ t: 'word', v: s });
      continue;
    }

    // number (possibly with K/M/B/T or % suffix)
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      if (src[j] === '-') j++;
      while (j < n && /[0-9._]/.test(src[j])) j++;
      if (src[j] === 'e' || src[j] === 'E') {
        j++;
        if (src[j] === '+' || src[j] === '-') j++;
        while (j < n && /[0-9]/.test(src[j])) j++;
      }
      let raw = src.slice(i, j).replace(/_/g, '');
      let v = Number(raw);
      if (Number.isNaN(v)) throw new Error(`Bad number near "${raw}"`);
      const suf = (src[j] || '').toUpperCase();
      if (suf === 'K') { v *= 1e3; j++; }
      else if (suf === 'M') { v *= 1e6; j++; }
      else if (suf === 'B') { v *= 1e9; j++; }
      else if (suf === 'T') { v *= 1e12; j++; }
      else if (suf === '%') { v /= 100;  j++; }
      out.push({ t: 'num', v });
      i = j;
      continue;
    }

    // identifier / keyword
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const lc = word.toLowerCase();
      if (lc === 'and') out.push({ t: 'and' });
      else if (lc === 'or') out.push({ t: 'or' });
      else out.push({ t: 'word', v: word });
      i = j;
      continue;
    }

    throw new Error(`Unexpected character "${c}" at position ${i}`);
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Recursive-descent parser

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok | undefined { return this.toks[this.i]; }
  private next(): Tok | undefined { return this.toks[this.i++]; }

  parseExpr(): BoolNode {
    return this.parseOr();
  }
  private parseOr(): BoolNode {
    let left: BoolNode = this.parseAnd();
    while (this.peek()?.t === 'or') {
      this.next();
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }
  private parseAnd(): BoolNode {
    let left: BoolNode = this.parseComparison();
    while (this.peek()?.t === 'and') {
      this.next();
      const right = this.parseComparison();
      left = { kind: 'and', left, right };
    }
    return left;
  }
  private parseComparison(): Comparison {
    const ident = this.next();
    if (!ident || ident.t !== 'word') throw new Error('Expected a field name');
    const op = this.next();
    if (!op || op.t !== 'op') throw new Error(`Expected an operator after "${ident.v}"`);
    const val = this.next();
    if (!val) throw new Error(`Expected a value after "${ident.v} ${op.v}"`);

    const fieldKey = ident.v.toLowerCase();
    const isText = TEXT_FIELDS.has(fieldKey);

    if (isText) {
      if (val.t === 'num') {
        return { kind: 'cmp', field: fieldKey, op: op.v, value: String(val.v) };
      }
      if (val.t === 'word') {
        return { kind: 'cmp', field: fieldKey, op: op.v, value: val.v };
      }
      throw new Error(`Expected a text value for ${fieldKey}`);
    }

    if (!FIELD_MAP[fieldKey]) {
      throw new Error(`Unknown field "${ident.v}"`);
    }
    if (val.t !== 'num') {
      throw new Error(`Expected a number for ${fieldKey}`);
    }
    return { kind: 'cmp', field: fieldKey, op: op.v, value: val.v };
  }
}

export function parseQuery(src: string): Query {
  const toks = tokenise(src);
  if (toks.length === 0) throw new Error('Empty query');
  const p = new Parser(toks);
  const tree = p.parseExpr();
  if ((p as any).i !== toks.length) {
    throw new Error('Unexpected tokens at end of query');
  }
  return tree;
}

// ────────────────────────────────────────────────────────────────────────────
// Evaluator

function compareNumbers(a: number, op: Op, b: number): boolean {
  switch (op) {
    case '>':  return a >  b;
    case '>=': return a >= b;
    case '<':  return a <  b;
    case '<=': return a <= b;
    case '=':  return a === b;
    case '!=': return a !== b;
  }
}

function compareStrings(a: string, op: Op, b: string): boolean {
  const eq = a.toLowerCase() === b.toLowerCase();
  if (op === '=')  return eq;
  if (op === '!=') return !eq;
  // Lexical comparison for < > on strings is rarely useful — disallow for clarity.
  throw new Error(`Operator ${op} not supported for text fields`);
}

function evalCmp(row: ScreenerRow, cmp: Comparison): boolean {
  if (TEXT_FIELDS.has(cmp.field)) {
    if (cmp.field === 'tag') {
      const wanted = String(cmp.value).toLowerCase();
      const has = (row.tags || []).some(t => t.toLowerCase() === wanted);
      if (cmp.op === '=')  return has;
      if (cmp.op === '!=') return !has;
      throw new Error('Tag only supports = and !=');
    }
    const rowVal = cmp.field === 'country' ? (row.country || '') : (row.sector || '');
    return compareStrings(rowVal, cmp.op, String(cmp.value));
  }
  const key = FIELD_MAP[cmp.field];
  const raw = (row as any)[key];
  if (raw == null || !Number.isFinite(raw)) return false; // null rows can't satisfy a numeric constraint
  return compareNumbers(raw as number, cmp.op, cmp.value as number);
}

export function matchesQuery(row: ScreenerRow, q: Query): boolean {
  switch (q.kind) {
    case 'cmp': return evalCmp(row, q);
    case 'and': return matchesQuery(row, q.left) && matchesQuery(row, q.right);
    case 'or':  return matchesQuery(row, q.left) || matchesQuery(row, q.right);
  }
}
