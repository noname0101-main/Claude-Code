/*
 * Hygge – et lille programmeringssprog på dansk.
 *
 * Hele sproget bor i denne fil og arbejder i tre trin:
 *
 *   1. Lexeren (tokenize)  deler kildekoden op i små stykker, kaldet tokens:
 *                          ord, tal, tekster og tegn som + og {.
 *   2. Parseren (parse)    læser tokens og bygger et syntakstræ, der viser,
 *                          hvordan programmet hænger sammen.
 *   3. Fortolkeren (run)   går træet igennem og udfører programmet.
 *
 * Filen virker både i browseren (som window.Hygge) og i Node.js
 * (const Hygge = require('./hygge')).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Hygge = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════
  //  Ord og grænser
  // ════════════════════════════════════════════════════════════════════

  /** Ord, der betyder noget særligt i Hygge og derfor ikke kan bruges som navne. */
  const KEYWORDS = [
    'sæt', 'skriv', 'hvis', 'ellers', 'gentag', 'mens', 'for', 'funktion',
    'returner', 'stop', 'fortsæt', 'og', 'eller', 'ikke', 'sandt', 'falsk', 'intet',
  ];
  const KEYWORD_SET = new Set(KEYWORDS);

  /** Ord, der kun betyder noget bestemte steder, fx 'gange' i 'gentag 3 gange'. */
  const CONTEXT_WORDS = ['gange', 'hver', 'i', 'fra', 'til', 'trin'];

  /** Ord, en linje kan starte med. Bruges til at foreslå rettelser af stavefejl. */
  const STATEMENT_WORDS = ['sæt', 'skriv', 'hvis', 'gentag', 'mens', 'for', 'funktion', 'returner', 'stop', 'fortsæt'];

  /** Hjælp til folk, der kender Python, JavaScript eller lignende sprog. */
  const ENGLISH_HINTS = new Map(Object.entries({
    print: 'skriv', if: 'hvis', else: 'ellers', elif: 'ellers hvis', while: 'mens',
    function: 'funktion', def: 'funktion', return: 'returner', true: 'sandt', True: 'sandt',
    false: 'falsk', False: 'falsk', null: 'intet', None: 'intet', len: 'længde',
    input: 'spørg', let: 'sæt', var: 'sæt', const: 'sæt', set: 'sæt', break: 'stop',
    continue: 'fortsæt', and: 'og', or: 'eller', not: 'ikke', repeat: 'gentag', append: 'tilføj',
  }));

  /** Grænser, der forhindrer et program i at få browseren til at hænge. */
  const LIMITS = { steps: 5000000, depth: 800, outputLines: 10000, drawOps: 100000 };

  /** Farver, som skildpadden kender. */
  const COLORS = {
    rød: '#d62828', orange: '#f28c18', gul: '#f2c516', grøn: '#2a9d4b',
    turkis: '#16a3a3', blå: '#1f5fd6', lilla: '#7b3fc4', pink: '#e85d9f',
    brun: '#8b5a2b', grå: '#8a8f98', sort: '#16181d', hvid: '#ffffff',
  };

  // ════════════════════════════════════════════════════════════════════
  //  Fejl
  // ════════════════════════════════════════════════════════════════════

  /** En fejl i et Hygge-program. Har linjenummer, når vi kender det. */
  class HyggeFejl extends Error {
    constructor(message, line, col) {
      super(message);
      this.name = 'HyggeFejl';
      this.line = line ?? null;
      this.col = col ?? null;
    }
  }

  function fail(message, at) {
    throw new HyggeFejl(message, at ? at.line : null, at ? at.col : null);
  }

  /** Afstand mellem to ord (antal bogstaver, der skal ændres). Bruges til "Mente du ...?". */
  function distance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function closest(name, candidates) {
    const lower = name.toLowerCase();
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      if (candidate === name) continue;
      const d = distance(lower, candidate.toLowerCase());
      if (d < bestDistance) { best = candidate; bestDistance = d; }
    }
    // Korte navne ligner alt for mange andre, så dem gætter vi kun på, hvis kun store/små bogstaver er forskellige.
    const limit = name.length <= 2 ? 0 : name.length <= 4 ? 1 : 2;
    return bestDistance <= limit ? best : null;
  }

  // ════════════════════════════════════════════════════════════════════
  //  1. Lexeren: tekst → tokens
  // ════════════════════════════════════════════════════════════════════

  const IDENT_START = /[\p{L}_]/u;
  const IDENT_PART = /[\p{L}\p{N}_]/u;
  const isDigit = (c) => c !== undefined && c >= '0' && c <= '9';
  const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '+=', '-=', '*=', '/=']);
  const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '^', '<', '>', '=', '(', ')', '{', '}', '[', ']', ',']);
  const UNICODE_OPS = { '≠': '!=', '≤': '<=', '≥': '>=' };
  // Telefoner skriver ofte “krøllede” anførselstegn, så dem forstår vi også.
  const QUOTES = { '"': '"“”', '“': '”“"', '„': '“”"', '”': '”“"', "'": "'‘’", '‘': "’‘'", '’': "’‘'" };
  const CLOSER = { '(': ')', '[': ']', '{': '}' };
  const OPENER = { ')': '(', ']': '[', '}': '{' };
  const CHAR_HINTS = {
    '!': "Brug ordet 'ikke' i stedet for '!'. ('!=' betyder 'er forskellig fra'.)",
    '&': "Brug ordet 'og' i stedet for '&'",
    '|': "Brug ordet 'eller' i stedet for '|'",
    ':': "Hygge bruger { og } omkring blokke i stedet for ':'",
    '.': 'Et punktum skal stå mellem to cifre, fx 3.5',
  };

  function tokenize(source) {
    const src = String(source).replace(/\r\n?/g, '\n');
    const tokens = [];
    const open = []; // stak med de parenteser, der endnu ikke er lukket
    let i = 0;
    let line = 1;
    let col = 1;
    const add = (type, value, l, c, length) => tokens.push({ type, value, line: l, col: c, length });

    while (i < src.length) {
      const ch = src[i];

      // Linjeskift afslutter en kommando – men ikke inde i ( ) og [ ].
      if (ch === '\n') {
        const top = open[open.length - 1];
        if (!top || top.value === '{') add('nl', '\n', line, col, 1);
        i++; line++; col = 1;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === ' ' || ch === '﻿') { i++; col++; continue; }
      if (ch === '#') {
        while (i < src.length && src[i] !== '\n') { i++; col++; }
        continue;
      }

      const start = i;
      const l = line;
      const c = col;

      // Tal: 42 eller 3.14
      if (isDigit(ch)) {
        while (isDigit(src[i])) i++;
        if (src[i] === '.' && isDigit(src[i + 1])) {
          i++;
          while (isDigit(src[i])) i++;
        }
        if (i < src.length && IDENT_START.test(src[i])) {
          fail('Et tal og et navn står klistret sammen her. Mangler der et mellemrum?', { line: l, col: c });
        }
        add('num', Number(src.slice(start, i)), l, c, i - start);
        col += i - start;
        continue;
      }

      // Tekst: "hej" eller 'hej'
      if (Object.prototype.hasOwnProperty.call(QUOTES, ch)) {
        const closers = QUOTES[ch];
        let j = i + 1;
        let text = '';
        for (;;) {
          if (j >= src.length || src[j] === '\n') {
            fail('Teksten mangler et afsluttende anførselstegn (")', { line: l, col: c });
          }
          const d = src[j];
          if (closers.includes(d)) { j++; break; }
          if (d === '\\' && j + 1 < src.length && src[j + 1] !== '\n') {
            const e = src[j + 1];
            text += e === 'n' ? '\n' : e === 't' ? '\t' : e;
            j += 2;
            continue;
          }
          text += d;
          j++;
        }
        add('str', text, l, c, j - start);
        col += j - start;
        i = j;
        continue;
      }

      // Ord: nøgleord som 'hvis' eller navne som 'alder'
      if (IDENT_START.test(ch)) {
        let j = i + 1;
        while (j < src.length && IDENT_PART.test(src[j])) j++;
        const word = src.slice(i, j);
        add(KEYWORD_SET.has(word) ? 'kw' : 'ident', word, l, c, j - i);
        col += j - i;
        i = j;
        continue;
      }

      // Tegn: + - * / ( ) { } osv.
      const two = src.slice(i, i + 2);
      let op = null;
      let len = 1;
      if (TWO_CHAR_OPS.has(two)) { op = two; len = 2; }
      else if (Object.prototype.hasOwnProperty.call(UNICODE_OPS, ch)) op = UNICODE_OPS[ch];
      else if (ONE_CHAR_OPS.has(ch)) op = ch;
      else if (ch === ';') { add('nl', ';', l, c, 1); i++; col++; continue; }
      if (!op) fail(CHAR_HINTS[ch] || `Jeg kender ikke tegnet '${ch}'`, { line: l, col: c });

      if (CLOSER[op]) {
        open.push({ value: op, line: l, col: c });
      } else if (OPENER[op]) {
        const top = open[open.length - 1];
        if (top && top.value === OPENER[op]) open.pop();
        else if (top) fail(`'${top.value}' på linje ${top.line} skal lukkes med '${CLOSER[top.value]}' før '${op}'`, { line: l, col: c });
        // Er der slet ingen åbne parenteser, melder parseren fejlen.
      }
      add('op', op, l, c, len);
      i += len;
      col += len;
    }

    if (open.length) {
      const top = open[open.length - 1];
      fail(top.value === '{'
        ? `Blokken, der starter med '{' på linje ${top.line}, mangler en afsluttende '}'`
        : `'${top.value}' på linje ${top.line} bliver aldrig lukket med '${CLOSER[top.value]}'`, top);
    }
    add('nl', '\n', line, col, 0);
    add('eof', '', line, col, 0);
    return tokens;
  }

  // ════════════════════════════════════════════════════════════════════
  //  2. Parseren: tokens → syntakstræ
  // ════════════════════════════════════════════════════════════════════

  const COMPARE_OPS = new Set(['=', '==', '!=', '<', '>', '<=', '>=']);
  const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=']);

  function describeToken(t) {
    switch (t.type) {
      case 'num': return `tallet ${t.value}`;
      case 'str': return `teksten "${t.value}"`;
      case 'ident': return `'${t.value}'`;
      case 'kw': return `ordet '${t.value}'`;
      case 'op': return `'${t.value}'`;
      case 'nl': return t.value === ';' ? "';'" : 'slutningen af linjen';
      default: return 'slutningen af programmet';
    }
  }

  class Parser {
    constructor(tokens) {
      this.tokens = tokens;
      this.pos = 0;
      this.loops = 0;     // hvor mange løkker vi står inde i (til 'stop' og 'fortsæt')
      this.functions = 0; // hvor mange funktioner vi står inde i (til 'returner')
    }

    peek(ahead = 0) { return this.tokens[Math.min(this.pos + ahead, this.tokens.length - 1)]; }
    next() {
      const t = this.peek();
      if (this.pos < this.tokens.length - 1) this.pos++;
      return t;
    }
    isOp(value) { const t = this.peek(); return t.type === 'op' && t.value === value; }
    isKw(value) { const t = this.peek(); return t.type === 'kw' && t.value === value; }
    isWord(value, ahead = 0) { const t = this.peek(ahead); return t.type === 'ident' && t.value === value; }
    atEnd() {
      const t = this.peek();
      return t.type === 'nl' || t.type === 'eof' || (t.type === 'op' && t.value === '}');
    }
    skipNewlines() { while (this.peek().type === 'nl') this.next(); }

    expectOp(value, message) {
      if (!this.isOp(value)) fail(message || `Her mangler '${value}', men jeg fandt ${describeToken(this.peek())}`, this.peek());
      return this.next();
    }
    expectName(message) {
      const t = this.peek();
      if (t.type === 'ident') return this.next();
      if (t.type === 'kw') fail(`'${t.value}' er et reserveret ord i Hygge og kan ikke bruges som navn`, t);
      return fail(message, t);
    }

    // ── Kommandoer ──────────────────────────────────────────────────────

    program() {
      return { type: 'Program', body: this.statements(null), line: 1, col: 1 };
    }

    statements(openToken) {
      const body = [];
      this.skipNewlines();
      for (;;) {
        const t = this.peek();
        if (t.type === 'eof') {
          if (openToken) fail(`Blokken, der starter på linje ${openToken.line}, mangler en afsluttende '}'`, openToken);
          return body;
        }
        if (t.type === 'op' && t.value === '}') {
          if (!openToken) fail("Der er en '}' for meget her", t);
          return body;
        }
        body.push(this.statement());
        const end = this.peek();
        if (end.type === 'nl') this.next();
        else if (end.type !== 'eof' && !(end.type === 'op' && end.value === '}')) {
          fail(`Jeg forstod ikke ${describeToken(end)} her. Mangler der et komma, et '+' eller et linjeskift?`, end);
        }
        this.skipNewlines();
      }
    }

    block() {
      this.skipNewlines();
      const open = this.peek();
      if (!this.isOp('{')) fail(`Her skal en blok starte med '{', men jeg fandt ${describeToken(open)}`, open);
      this.next();
      const body = this.statements(open);
      this.next(); // '}'
      return body;
    }

    loopBody() {
      this.loops++;
      try { return this.block(); } finally { this.loops--; }
    }

    statement() {
      const t = this.peek();
      if (t.type === 'kw') {
        switch (t.value) {
          case 'sæt': return this.setStatement();
          case 'skriv': return this.printStatement();
          case 'hvis': return this.ifStatement();
          case 'gentag': return this.repeatStatement();
          case 'mens': return this.whileStatement();
          case 'for': return this.forStatement();
          case 'returner': return this.returnStatement();
          case 'stop':
          case 'fortsæt': return this.loopControl();
          case 'funktion':
            if (this.peek(1).type === 'ident') return this.functionDeclaration();
            break;
          case 'ellers': fail("'ellers' skal stå lige efter '}' i en 'hvis'-blok", t);
        }
      }

      // Ellers skal linjen være et funktionskald, fx tilføj(liste, 5)
      const expr = this.expression();
      const after = this.peek();
      if (after.type === 'op' && ASSIGN_OPS.has(after.value)) {
        const name = expr.type === 'Var' ? expr.name : 'x';
        fail(`Brug 'sæt', når du ændrer en variabel, fx: sæt ${name} ${after.value} 1`, t);
      }
      if (expr.type === 'Binary' && expr.raw === '=') {
        const name = expr.left.type === 'Var' ? expr.left.name : 'x';
        fail(`Brug 'sæt', når du giver en variabel en værdi, fx: sæt ${name} = ...`, t);
      }
      if (expr.type === 'Var') {
        const hint = ENGLISH_HINTS.get(expr.name);
        if (hint) fail(`Hygge er på dansk: skriv '${hint}' i stedet for '${expr.name}'`, t);
        if (!this.atEnd()) {
          const guess = closest(expr.name, STATEMENT_WORDS);
          fail(guess
            ? `Jeg kender ikke kommandoen '${expr.name}'. Mente du '${guess}'?`
            : `Jeg forstod ikke '${expr.name}' her. En linje starter typisk med en kommando som skriv, sæt, hvis, gentag, mens eller for`, t);
        }
      }
      if (expr.type !== 'Call') {
        fail("Denne linje regner en værdi ud, men gør ikke noget med den. Vil du vise værdien, så skriv 'skriv' foran", t);
      }
      return { type: 'ExprStmt', expr, line: t.line, col: t.col };
    }

    setStatement() {
      const kw = this.next();
      const nameToken = this.expectName("Efter 'sæt' skal der stå et navn, fx: sæt alder = 12");
      let target = { type: 'Var', name: nameToken.value, line: nameToken.line, col: nameToken.col };
      while (this.isOp('[')) {
        const open = this.next();
        const index = this.expression();
        this.expectOp(']', "Her mangler en ']'");
        target = { type: 'Index', object: target, index, line: open.line, col: open.col };
      }
      const opToken = this.peek();
      if (opToken.type === 'op' && ASSIGN_OPS.has(opToken.value)) this.next();
      else if (opToken.type === 'op' && opToken.value === '==') fail(`Brug ét '=' når du giver en variabel en værdi: sæt ${nameToken.value} = ...`, opToken);
      else fail(`Efter 'sæt ${nameToken.value}' mangler der et '=', fx: sæt ${nameToken.value} = 10`, opToken);
      const value = this.expression();
      return { type: 'Set', target, op: opToken.value, value, line: kw.line, col: kw.col };
    }

    printStatement() {
      const kw = this.next();
      const args = [];
      if (!this.atEnd()) {
        args.push(this.expression());
        while (this.isOp(',')) {
          this.next();
          args.push(this.expression());
        }
      }
      return { type: 'Print', args, line: kw.line, col: kw.col };
    }

    condition(word) {
      if (this.isOp('{') || this.atEnd()) {
        fail(`Efter '${word}' mangler der en betingelse, fx: ${word} alder > 12 { ... }`, this.peek());
      }
      return this.expression();
    }

    ifStatement() {
      const kw = this.next();
      const branches = [{ cond: this.condition('hvis'), body: this.block() }];
      let otherwise = null;
      for (;;) {
        const saved = this.pos;
        this.skipNewlines();
        if (!this.isKw('ellers')) { this.pos = saved; break; }
        this.next();
        if (this.isKw('hvis')) {
          this.next();
          branches.push({ cond: this.condition('ellers hvis'), body: this.block() });
          continue;
        }
        otherwise = this.block();
        break;
      }
      return { type: 'If', branches, otherwise, line: kw.line, col: kw.col };
    }

    repeatStatement() {
      const kw = this.next();
      if (this.isOp('{') || this.atEnd()) fail('Skriv hvor mange gange, fx: gentag 5 gange { ... }', this.peek());
      const count = this.expression();
      if (!this.isWord('gange')) fail("Skriv 'gange' efter antallet, fx: gentag 5 gange { ... }", this.peek());
      this.next();
      return { type: 'Repeat', count, body: this.loopBody(), line: kw.line, col: kw.col };
    }

    whileStatement() {
      const kw = this.next();
      const cond = this.condition('mens');
      return { type: 'While', cond, body: this.loopBody(), line: kw.line, col: kw.col };
    }

    forStatement() {
      const kw = this.next();
      // for hver frugt i frugter { ... }
      if (this.isWord('hver') && this.peek(1).type === 'ident' && !this.isWord('fra', 1)) {
        this.next();
        const name = this.expectName('Skriv et navn efter "for hver"');
        if (!this.isWord('i')) fail(`Skriv 'i' efter navnet, fx: for hver ${name.value} i liste { ... }`, this.peek());
        this.next();
        const iterable = this.expression();
        return { type: 'ForEach', name: name.value, iterable, body: this.loopBody(), line: kw.line, col: kw.col };
      }
      // for i fra 1 til 10 { ... }
      const name = this.expectName("Efter 'for' skal der stå et navn, fx: for i fra 1 til 10 { ... } eller for hver ting i liste { ... }");
      if (this.isWord('i')) fail(`Skriv 'for hver ${name.value} i ...', når du vil gå en liste igennem`, name);
      if (!this.isWord('fra')) fail(`Skriv 'fra' efter '${name.value}', fx: for ${name.value} fra 1 til 10 { ... }`, this.peek());
      this.next();
      const from = this.expression();
      if (!this.isWord('til')) fail(`Skriv 'til' efter startværdien, fx: for ${name.value} fra 1 til 10 { ... }`, this.peek());
      this.next();
      const to = this.expression();
      let step = null;
      if (this.isWord('trin')) {
        this.next();
        step = this.expression();
      }
      return { type: 'ForRange', name: name.value, from, to, step, body: this.loopBody(), line: kw.line, col: kw.col };
    }

    functionDeclaration() {
      const kw = this.next();
      const name = this.next();
      const fn = this.functionRest(name.value);
      return { type: 'FuncDecl', name: name.value, params: fn.params, body: fn.body, line: kw.line, col: kw.col };
    }

    functionRest(name) {
      this.expectOp('(', `Efter funktionens navn skal der stå parenteser, fx: funktion ${name || 'hils'}(navn) { ... }`);
      const params = [];
      if (!this.isOp(')')) {
        for (;;) {
          const p = this.expectName('Her skal der stå navnet på en parameter');
          if (params.includes(p.value)) fail(`Parameteren '${p.value}' står der to gange`, p);
          params.push(p.value);
          if (!this.isOp(',')) break;
          this.next();
        }
      }
      this.expectOp(')', "Her mangler en ')' efter parametrene");
      const savedLoops = this.loops;
      this.loops = 0;
      this.functions++;
      try {
        return { params, body: this.block() };
      } finally {
        this.loops = savedLoops;
        this.functions--;
      }
    }

    returnStatement() {
      const kw = this.next();
      if (this.functions === 0) fail("'returner' kan kun bruges inde i en funktion", kw);
      const value = this.atEnd() ? null : this.expression();
      return { type: 'Return', value, line: kw.line, col: kw.col };
    }

    loopControl() {
      const kw = this.next();
      if (this.loops === 0) fail(`'${kw.value}' kan kun bruges inde i en løkke (gentag, mens eller for)`, kw);
      return { type: kw.value === 'stop' ? 'Break' : 'Continue', line: kw.line, col: kw.col };
    }

    // ── Udtryk (fra laveste til højeste prioritet) ────────────────────────

    expression() { return this.orExpr(); }

    orExpr() {
      let left = this.andExpr();
      while (this.isKw('eller')) {
        const op = this.next();
        this.skipNewlines();
        left = { type: 'Logical', op: 'eller', left, right: this.andExpr(), line: op.line, col: op.col };
      }
      return left;
    }

    andExpr() {
      let left = this.notExpr();
      while (this.isKw('og')) {
        const op = this.next();
        this.skipNewlines();
        left = { type: 'Logical', op: 'og', left, right: this.notExpr(), line: op.line, col: op.col };
      }
      return left;
    }

    notExpr() {
      if (this.isKw('ikke')) {
        const op = this.next();
        return { type: 'Not', arg: this.notExpr(), line: op.line, col: op.col };
      }
      return this.comparison();
    }

    comparison() {
      const left = this.additive();
      const t = this.peek();
      if (t.type !== 'op' || !COMPARE_OPS.has(t.value)) return left;
      this.next();
      this.skipNewlines();
      const right = this.additive();
      const again = this.peek();
      if (again.type === 'op' && COMPARE_OPS.has(again.value)) {
        fail("Du kan ikke sammenligne tre ting på én gang. Brug 'og', fx: 1 < x og x < 10", again);
      }
      // I Hygge betyder både = og == "er lig med", når det står i et udtryk.
      return { type: 'Binary', op: t.value === '==' ? '=' : t.value, raw: t.value, left, right, line: t.line, col: t.col };
    }

    additive() {
      let left = this.multiplicative();
      while (this.isOp('+') || this.isOp('-')) {
        const op = this.next();
        this.skipNewlines();
        left = { type: 'Binary', op: op.value, raw: op.value, left, right: this.multiplicative(), line: op.line, col: op.col };
      }
      return left;
    }

    multiplicative() {
      let left = this.unary();
      while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
        const op = this.next();
        this.skipNewlines();
        left = { type: 'Binary', op: op.value, raw: op.value, left, right: this.unary(), line: op.line, col: op.col };
      }
      return left;
    }

    unary() {
      if (this.isOp('-')) {
        const op = this.next();
        return { type: 'Neg', arg: this.unary(), line: op.line, col: op.col };
      }
      return this.power();
    }

    power() {
      const base = this.postfix();
      if (!this.isOp('^')) return base;
      const op = this.next();
      this.skipNewlines();
      return { type: 'Binary', op: '^', raw: '^', left: base, right: this.unary(), line: op.line, col: op.col };
    }

    postfix() {
      let expr = this.primary();
      for (;;) {
        if (this.isOp('(')) {
          this.next();
          const args = [];
          if (!this.isOp(')')) {
            for (;;) {
              args.push(this.expression());
              if (!this.isOp(',')) break;
              this.next();
            }
          }
          this.expectOp(')', `Her mangler en ')' eller et komma mellem værdierne, men jeg fandt ${describeToken(this.peek())}`);
          expr = { type: 'Call', callee: expr, args, line: expr.line, col: expr.col };
          continue;
        }
        if (this.isOp('[')) {
          const open = this.next();
          const index = this.expression();
          this.expectOp(']', "Her mangler en ']'");
          expr = { type: 'Index', object: expr, index, line: open.line, col: open.col };
          continue;
        }
        return expr;
      }
    }

    primary() {
      const t = this.peek();
      const at = { line: t.line, col: t.col };
      switch (t.type) {
        case 'num':
        case 'str':
          this.next();
          return { type: 'Lit', value: t.value, ...at };
        case 'ident':
          this.next();
          return { type: 'Var', name: t.value, ...at };
        case 'kw':
          if (t.value === 'sandt' || t.value === 'falsk') { this.next(); return { type: 'Lit', value: t.value === 'sandt', ...at }; }
          if (t.value === 'intet') { this.next(); return { type: 'Lit', value: null, ...at }; }
          if (t.value === 'funktion') {
            this.next();
            const fn = this.functionRest(null);
            return { type: 'FuncLit', params: fn.params, body: fn.body, ...at };
          }
          return fail(`Ordet '${t.value}' kan ikke stå her. Her skulle have stået en værdi, fx et tal, en tekst eller et navn`, t);
        case 'op':
          if (t.value === '(') {
            this.next();
            const inner = this.expression();
            this.expectOp(')', `Her mangler en ')', men jeg fandt ${describeToken(this.peek())}`);
            return inner;
          }
          if (t.value === '[') {
            this.next();
            const items = [];
            while (!this.isOp(']')) {
              items.push(this.expression());
              if (!this.isOp(',')) break;
              this.next();
            }
            this.expectOp(']', `Her mangler et komma eller en ']', men jeg fandt ${describeToken(this.peek())}`);
            return { type: 'List', items, ...at };
          }
          return fail(`Her mangler en værdi, men jeg fandt '${t.value}'`, t);
        default:
          return fail(`Her mangler en værdi, men jeg fandt ${describeToken(t)}`, t);
      }
    }
  }

  function parse(source) {
    return new Parser(tokenize(source)).program();
  }

  // ════════════════════════════════════════════════════════════════════
  //  Værdier
  // ════════════════════════════════════════════════════════════════════

  class UserFunction {
    constructor(name, params, body, closure) {
      this.name = name;
      this.params = params;
      this.body = body;
      this.closure = closure;
    }
  }

  class Builtin {
    constructor(spec) { Object.assign(this, spec); }
  }

  /** Et sted, hvor variabler bor. Hver funktion får sit eget. */
  class Scope {
    constructor(parent, isBuiltin = false) {
      this.vars = new Map();
      this.parent = parent;
      this.isBuiltin = isBuiltin;
    }
    find(name) {
      for (let s = this; s; s = s.parent) if (s.vars.has(name)) return s;
      return null;
    }
  }

  function typeName(v) {
    if (v === null || v === undefined) return 'intet';
    if (typeof v === 'number') return 'tal';
    if (typeof v === 'string') return 'tekst';
    if (typeof v === 'boolean') return 'sandhedsværdi';
    if (Array.isArray(v)) return 'liste';
    return 'funktion';
  }

  const ARTICLES = { tal: 'et tal', tekst: 'en tekst', sandhedsværdi: 'en sandhedsværdi', intet: 'intet', liste: 'en liste', funktion: 'en funktion' };
  const an = (v) => ARTICLES[typeName(v)];

  function formatNumber(n) {
    if (Number.isNaN(n)) return 'ikke-et-tal';
    if (n === Infinity) return 'uendelig';
    if (n === -Infinity) return '-uendelig';
    if (Number.isInteger(n)) return String(n);
    // Afrund små regnefejl væk, så 0.1 + 0.2 bliver 0.3
    return String(parseFloat(n.toPrecision(12)));
  }

  /** Laver en værdi om til tekst. Inde i lister får tekster anførselstegn. */
  function format(v, nested = false, seen = new Set()) {
    switch (typeName(v)) {
      case 'intet': return 'intet';
      case 'tal': return formatNumber(v);
      case 'tekst': return nested ? JSON.stringify(v) : v;
      case 'sandhedsværdi': return v ? 'sandt' : 'falsk';
      case 'liste': {
        if (seen.has(v)) return '[...]';
        seen.add(v);
        const text = '[' + v.map((x) => format(x, true, seen)).join(', ') + ']';
        seen.delete(v);
        return text;
      }
      default: return v.name ? `<funktion ${v.name}>` : '<funktion>';
    }
  }

  function equal(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
      return true;
    }
    return false;
  }

  /** Hvad tæller som "sandt" i en betingelse. 0, "", tomme lister, falsk og intet er falsk. */
  function truthy(v) {
    if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }

  function needNumber(v, fn) {
    if (typeof v !== 'number' || Number.isNaN(v)) fail(`${fn}() skal have et tal, men fik ${an(v)}`);
    return v;
  }
  function needInteger(v, fn) {
    needNumber(v, fn);
    if (!Number.isInteger(v)) fail(`${fn}() skal have et helt tal, men fik ${formatNumber(v)}`);
    return v;
  }
  function needText(v, fn) {
    if (typeof v !== 'string') fail(`${fn}() skal have en tekst, men fik ${an(v)}`);
    return v;
  }
  function needList(v, fn) {
    if (!Array.isArray(v)) fail(`${fn}() skal have en liste, men fik ${an(v)}`);
    return v;
  }

  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const s = v.trim().replace(',', '.');
      if (/^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(s)) return Number(s);
      fail(`Kan ikke lave "${v}" om til et tal`);
    }
    return fail(`tal() kan kun lave tekst om til tal, men fik ${an(v)}`);
  }

  function resolveColor(args, fn) {
    if (args.length === 3) {
      const clamp = (x) => Math.max(0, Math.min(255, Math.round(needNumber(x, fn))));
      return `rgb(${clamp(args[0])}, ${clamp(args[1])}, ${clamp(args[2])})`;
    }
    if (args.length !== 1) fail(`${fn}() skal have et farvenavn eller tre tal (rød, grøn, blå)`);
    const v = args[0];
    if (typeof v !== 'string') fail(`${fn}() skal have et farvenavn som tekst, fx ${fn}("blå")`);
    const key = v.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(COLORS, key)) return COLORS[key];
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(key)) return key;
    return fail(`Jeg kender ikke farven "${v}". Prøv en af disse: ${Object.keys(COLORS).join(', ')}. Eller brug en farvekode som "#ff8800"`);
  }

  function sortedCopy(list, fn) {
    const copy = needList(list, fn).slice();
    if (copy.every((x) => typeof x === 'number')) return copy.sort((a, b) => a - b);
    if (copy.every((x) => typeof x === 'string')) return copy.sort((a, b) => a.localeCompare(b, 'da'));
    return fail(`${fn}() kan kun sortere lister, hvor alt er tal, eller alt er tekst`);
  }

  function numbersFrom(args, fn) {
    const list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (!list.length) fail(`${fn}() kan ikke finde noget i en tom liste`);
    return list.map((x) => needNumber(x, fn));
  }

  // ════════════════════════════════════════════════════════════════════
  //  Indbyggede funktioner
  // ════════════════════════════════════════════════════════════════════

  const BUILTINS = [];
  function builtin(name, group, params, description, min, max, impl) {
    BUILTINS.push({ name, group, params, description, min, max, impl });
  }

  // Tekst og typer
  builtin('tekst', 'Tekst og typer', 'værdi', 'Laver en værdi om til tekst.', 1, 1, (v) => format(v));
  builtin('tal', 'Tekst og typer', 'tekst', 'Laver en tekst om til et tal, fx tal("42"). Både 3.5 og 3,5 virker.', 1, 1, toNumber);
  builtin('type', 'Tekst og typer', 'værdi', 'Giver typen som tekst: "tal", "tekst", "liste", "sandhedsværdi", "funktion" eller "intet".', 1, 1, typeName);
  builtin('store_bogstaver', 'Tekst og typer', 'tekst', 'Giver teksten med STORE bogstaver.', 1, 1,
    (t) => needText(t, 'store_bogstaver').toLocaleUpperCase('da'));
  builtin('små_bogstaver', 'Tekst og typer', 'tekst', 'Giver teksten med små bogstaver.', 1, 1,
    (t) => needText(t, 'små_bogstaver').toLocaleLowerCase('da'));
  builtin('opdel', 'Tekst og typer', 'tekst, skilletegn', 'Deler en tekst op i en liste. Uden skilletegn deles der ved mellemrum.', 1, 2, (t, sep) => {
    needText(t, 'opdel');
    if (sep === undefined) return t.split(/\s+/).filter(Boolean);
    needText(sep, 'opdel');
    return sep === '' ? Array.from(t) : t.split(sep);
  });
  builtin('saml', 'Tekst og typer', 'liste, skilletegn', 'Samler en liste til én tekst med skilletegnet imellem.', 1, 2, (list, sep = '') => {
    needList(list, 'saml');
    return list.map((x) => format(x)).join(needText(sep, 'saml'));
  });
  builtin('erstat', 'Tekst og typer', 'tekst, find, med', 'Erstatter alle steder i teksten, hvor find står, med noget andet.', 3, 3, (t, find, by) => {
    needText(t, 'erstat');
    needText(find, 'erstat');
    if (find === '') fail('erstat() skal have noget at finde – teksten må ikke være tom');
    return t.split(find).join(format(by));
  });

  // Lister
  builtin('længde', 'Lister', 'liste eller tekst', 'Antal elementer i en liste eller tegn i en tekst.', 1, 1, (x) => {
    if (Array.isArray(x)) return x.length;
    if (typeof x === 'string') return Array.from(x).length;
    return fail(`længde() virker kun på en liste eller en tekst, men fik ${an(x)}`);
  });
  builtin('tilføj', 'Lister', 'liste, værdi', 'Lægger værdien til sidst i listen.', 2, 2, (list, v) => {
    needList(list, 'tilføj').push(v);
  });
  builtin('indsæt', 'Lister', 'liste, plads, værdi', 'Sætter værdien ind på pladsen og skubber resten én plads frem.', 3, 3, (list, at, v) => {
    needList(list, 'indsæt');
    needInteger(at, 'indsæt');
    const i = at < 0 ? list.length + at + 1 : at;
    if (i < 0 || i > list.length) fail(`indsæt() kan ikke bruge plads ${at}, når listen har ${list.length} elementer`);
    list.splice(i, 0, v);
  });
  builtin('fjern', 'Lister', 'liste, plads', 'Fjerner det sidste element og giver det tilbage. Med en plads fjernes elementet der.', 1, 2, function (list, at) {
    needList(list, 'fjern');
    if (!list.length) fail('fjern() kan ikke fjerne noget fra en tom liste');
    if (at === undefined) return list.pop();
    return list.splice(this.checkIndex(list, at, null, 'liste'), 1)[0];
  });
  builtin('indeholder', 'Lister', 'samling, værdi', 'Giver sandt, hvis værdien findes i listen eller teksten.', 2, 2, (coll, v) => {
    if (Array.isArray(coll)) return coll.some((x) => equal(x, v));
    if (typeof coll === 'string') return coll.includes(format(v));
    return fail(`indeholder() virker kun på en liste eller en tekst, men fik ${an(coll)}`);
  });
  builtin('position', 'Lister', 'samling, værdi', 'Pladsen, hvor værdien står første gang – eller -1, hvis den ikke findes.', 2, 2, (coll, v) => {
    if (Array.isArray(coll)) return coll.findIndex((x) => equal(x, v));
    if (typeof coll === 'string') {
      const i = coll.indexOf(format(v));
      return i < 0 ? -1 : Array.from(coll.slice(0, i)).length;
    }
    return fail(`position() virker kun på en liste eller en tekst, men fik ${an(coll)}`);
  });
  builtin('sorter', 'Lister', 'liste', 'Giver en ny, sorteret liste. Tekster sorteres med æ, ø og å til sidst.', 1, 1, (list) => sortedCopy(list, 'sorter'));
  builtin('omvendt', 'Lister', 'liste eller tekst', 'Giver listen eller teksten bagfra.', 1, 1, (x) => {
    if (Array.isArray(x)) return x.slice().reverse();
    if (typeof x === 'string') return Array.from(x).reverse().join('');
    return fail(`omvendt() virker kun på en liste eller en tekst, men fik ${an(x)}`);
  });
  builtin('sum', 'Lister', 'liste', 'Lægger alle tallene i listen sammen.', 1, 1,
    (list) => needList(list, 'sum').reduce((s, x) => s + needNumber(x, 'sum'), 0));
  builtin('mindst', 'Lister', 'liste eller tal', 'Det mindste tal, fx mindst(point) eller mindst(4, 9, 2).', 1, Infinity,
    (...args) => Math.min(...numbersFrom(args, 'mindst')));
  builtin('størst', 'Lister', 'liste eller tal', 'Det største tal, fx størst(point) eller størst(4, 9, 2).', 1, Infinity,
    (...args) => Math.max(...numbersFrom(args, 'størst')));

  // Matematik
  builtin('tilfældig', 'Matematik', 'fra, til', 'Et tilfældigt helt tal fra og med fra til og med til. tilfældig(6) slår med en terning, og tilfældig(liste) vælger et element.', 0, 2, function (a, b) {
    const r = this.random();
    if (a === undefined) return r;
    if (b === undefined) {
      if (Array.isArray(a) || typeof a === 'string') {
        const items = Array.isArray(a) ? a : Array.from(a);
        if (!items.length) fail('tilfældig() kan ikke vælge noget fra en tom liste');
        return items[Math.floor(r * items.length)];
      }
      const n = needInteger(a, 'tilfældig');
      if (n < 1) fail('tilfældig(n) skal have et tal, der er 1 eller større');
      return 1 + Math.floor(r * n);
    }
    let lo = needInteger(a, 'tilfældig');
    let hi = needInteger(b, 'tilfældig');
    if (lo > hi) [lo, hi] = [hi, lo];
    return lo + Math.floor(r * (hi - lo + 1));
  });
  builtin('afrund', 'Matematik', 'tal, decimaler', 'Afrunder til nærmeste hele tal – eller til et antal decimaler, fx afrund(3.14159, 2).', 1, 2, (x, d = 0) => {
    needNumber(x, 'afrund');
    needInteger(d, 'afrund');
    const f = 10 ** d;
    return (Math.sign(x) * Math.round(Math.abs(x) * f * (1 + Number.EPSILON))) / f;
  });
  builtin('rund_ned', 'Matematik', 'tal', 'Runder ned til et helt tal.', 1, 1, (x) => Math.floor(needNumber(x, 'rund_ned')));
  builtin('rund_op', 'Matematik', 'tal', 'Runder op til et helt tal.', 1, 1, (x) => Math.ceil(needNumber(x, 'rund_op')));
  builtin('kvadratrod', 'Matematik', 'tal', 'Kvadratroden, fx kvadratrod(144) er 12.', 1, 1, (x) => {
    if (needNumber(x, 'kvadratrod') < 0) fail('Man kan ikke tage kvadratroden af et negativt tal');
    return Math.sqrt(x);
  });
  builtin('absolut', 'Matematik', 'tal', 'Tallet uden minus foran.', 1, 1, (x) => Math.abs(needNumber(x, 'absolut')));

  // Input
  builtin('spørg', 'Input', 'spørgsmål', 'Stiller et spørgsmål og venter på et svar. Svaret er altid en tekst – brug tal(...) for at regne med det.', 0, 1, function (q) {
    return this.ask(q);
  });

  // Tegning med skildpadden
  builtin('fremad', 'Tegning', 'afstand', 'Går fremad og tegner en streg, hvis pennen er nede.', 1, 1, function (d) { this.move(needNumber(d, 'fremad')); });
  builtin('tilbage', 'Tegning', 'afstand', 'Går baglæns.', 1, 1, function (d) { this.move(-needNumber(d, 'tilbage')); });
  builtin('drej_højre', 'Tegning', 'grader', 'Drejer mod højre. 90 er en kvart omgang, 360 en hel.', 1, 1, function (g) { this.turn(needNumber(g, 'drej_højre')); });
  builtin('drej_venstre', 'Tegning', 'grader', 'Drejer mod venstre.', 1, 1, function (g) { this.turn(-needNumber(g, 'drej_venstre')); });
  builtin('pen_op', 'Tegning', '', 'Løfter pennen, så skildpadden kan flytte sig uden at tegne.', 0, 0, function () { this.turtle.pen = false; });
  builtin('pen_ned', 'Tegning', '', 'Sætter pennen ned igen.', 0, 0, function () { this.turtle.pen = true; });
  builtin('farve', 'Tegning', 'farve', 'Skifter pennens farve, fx farve("blå"). Tre tal blander selv: farve(255, 120, 0).', 1, 3, function (...args) {
    this.turtle.color = resolveColor(args, 'farve');
  });
  builtin('tykkelse', 'Tegning', 'tal', 'Gør stregen tykkere eller tyndere. Den starter på 2.', 1, 1, function (w) {
    if (needNumber(w, 'tykkelse') <= 0) fail('tykkelse() skal have et tal, der er større end 0');
    this.turtle.width = w;
  });
  builtin('gå_til', 'Tegning', 'x, y', 'Flytter skildpadden til et punkt. Midten af papiret er (0, 0).', 2, 2, function (x, y) {
    this.moveTo(needNumber(x, 'gå_til'), needNumber(y, 'gå_til'));
  });
  builtin('cirkel', 'Tegning', 'radius, fyldt', 'Tegner en cirkel rundt om skildpadden. Giv sandt som anden værdi for at fylde den.', 1, 2, function (r, fill = false) {
    if (needNumber(r, 'cirkel') < 0) fail('cirkel() skal have en radius, der ikke er negativ');
    const t = this.turtle;
    this.draw({ kind: 'circle', x: t.x, y: t.y, r, angle: t.angle, color: t.color, width: t.width, fill: truthy(fill) });
  });
  builtin('baggrund', 'Tegning', 'farve', 'Farver hele papiret, fx baggrund("sort").', 1, 3, function (...args) {
    this.draw({ kind: 'background', color: resolveColor(args, 'baggrund') });
  });

  // ════════════════════════════════════════════════════════════════════
  //  3. Fortolkeren: syntakstræ → handling
  // ════════════════════════════════════════════════════════════════════

  // Signaler, som kommandoer giver tilbage for at hoppe ud af løkker og funktioner.
  // En almindelig kommando giver undefined tilbage og kører bare videre.
  const BREAK = { signal: 'stop' };
  const CONTINUE = { signal: 'fortsæt' };
  class ReturnSignal { constructor(value) { this.value = value; } }
  class NeedInput { constructor(question) { this.question = question; } }

  /** En lille tilfældighedsgenerator, der giver de samme tal, når den får det samme frø. */
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fjerner små regnefejl som 99.99999999998 og -0.
  const clean = (x) => Math.round(x * 1e9) / 1e9 || 0;

  function arityText(name, min, max, got) {
    const values = (n) => (n === 1 ? '1 værdi' : `${n} værdier`);
    let expected;
    if (min === max) expected = values(min);
    else if (max === Infinity) expected = `mindst ${values(min)}`;
    else expected = `mellem ${min} og ${max} værdier`;
    return `${name}() skal have ${expected}, men fik ${got}`;
  }

  class Interpreter {
    constructor(options = {}) {
      this.answers = options.answers || [];
      this.answerIndex = 0;
      this.askFn = options.ask || null;
      this.onOutput = options.onOutput || null;
      this.random = typeof options.seed === 'number' ? seededRandom(options.seed) : (options.random || Math.random);
      this.maxSteps = options.maxSteps || LIMITS.steps;
      this.output = [];
      this.drawing = [];
      this.turtle = { x: 0, y: 0, angle: 0, pen: true, color: null, width: 2 };
      this.steps = 0;
      this.depth = 0;
      this.current = null;
      this.builtins = new Scope(null, true);
      for (const spec of BUILTINS) this.builtins.vars.set(spec.name, new Builtin(spec));
      this.globals = new Scope(this.builtins);
    }

    runProgram(program) {
      this.hoist(program.body, this.globals);
      this.execBlock(program.body, this.globals);
    }

    tick(node) {
      if (++this.steps > this.maxSteps) {
        fail(`Programmet blev stoppet, fordi det kørte for længe (over ${this.maxSteps.toLocaleString('da-DK')} skridt). Har du en løkke, der aldrig slutter?`, node);
      }
    }

    emit(entry) {
      if (this.output.length >= LIMITS.outputLines) {
        fail(`Programmet skrev mere end ${LIMITS.outputLines.toLocaleString('da-DK')} linjer. Har du en løkke, der aldrig slutter?`, this.current);
      }
      this.output.push(entry);
      if (this.onOutput) this.onOutput(entry);
    }

    ask(question) {
      const q = question === undefined ? '' : format(question);
      let answer;
      if (this.answerIndex < this.answers.length) answer = this.answers[this.answerIndex++];
      else if (this.askFn) answer = this.askFn(q);
      else throw new NeedInput(q);
      answer = answer == null ? '' : String(answer);
      this.emit({ type: 'svar', question: q, answer });
      return answer;
    }

    // ── Skildpadden ────────────────────────────────────────────────────

    draw(op) {
      if (this.drawing.length >= LIMITS.drawOps) {
        fail(`Tegningen har mere end ${LIMITS.drawOps.toLocaleString('da-DK')} streger. Har du en løkke, der aldrig slutter?`, this.current);
      }
      this.drawing.push(op);
    }
    move(distance) {
      const t = this.turtle;
      const a = (t.angle * Math.PI) / 180;
      this.moveTo(t.x + distance * Math.sin(a), t.y + distance * Math.cos(a));
    }
    moveTo(x, y) {
      const t = this.turtle;
      const nx = clean(x);
      const ny = clean(y);
      if (t.pen) this.draw({ kind: 'line', x1: t.x, y1: t.y, x2: nx, y2: ny, color: t.color, width: t.width });
      t.x = nx;
      t.y = ny;
    }
    turn(degrees) {
      const t = this.turtle;
      t.angle = clean((((t.angle + degrees) % 360) + 360) % 360);
    }

    // ── Kommandoer ─────────────────────────────────────────────────────

    hoist(body, scope) {
      // Funktioner kan kaldes, før de står i koden.
      for (const s of body) {
        if (s.type === 'FuncDecl') scope.vars.set(s.name, new UserFunction(s.name, s.params, s.body, scope));
      }
    }

    /**
     * Kører kommandoerne i en blok én ad gangen. Giver et signal tilbage
     * (stop, fortsæt eller returner), hvis en kommando vil hoppe ud.
     */
    execBlock(body, scope) {
      for (let i = 0; i < body.length; i++) {
        const signal = this.exec(body[i], scope);
        if (signal !== undefined) return signal;
      }
      return undefined;
    }

    assign(name, value, scope) {
      const owner = scope.find(name);
      (owner && !owner.isBuiltin ? owner : scope).vars.set(name, value);
    }

    // Hver slags kommando har sin egen lille metode. Det holder hvert trin
    // lille, så dybe funktionskald ikke bruger hele JavaScripts stak.
    exec(node, scope) {
      this.current = node;
      this.tick(node);
      switch (node.type) {
        case 'Set': return this.execSet(node, scope);
        case 'Print': return this.execPrint(node, scope);
        case 'ExprStmt': this.eval(node.expr, scope); return undefined;
        case 'If': return this.execIf(node, scope);
        case 'Repeat': return this.execRepeat(node, scope);
        case 'While': return this.execWhile(node, scope);
        case 'ForRange': return this.execForRange(node, scope);
        case 'ForEach': return this.execForEach(node, scope);
        case 'FuncDecl':
          scope.vars.set(node.name, new UserFunction(node.name, node.params, node.body, scope));
          return undefined;
        case 'Return': return new ReturnSignal(node.value ? this.eval(node.value, scope) : null);
        case 'Break': return BREAK;
        case 'Continue': return CONTINUE;
        default: return fail(`Ukendt kommando: ${node.type}`, node);
      }
    }

    execPrint(node, scope) {
      const parts = [];
      for (const arg of node.args) parts.push(format(this.eval(arg, scope)));
      this.emit({ type: 'tekst', text: parts.join(' '), line: node.line });
      return undefined;
    }

    execIf(node, scope) {
      for (const branch of node.branches) {
        if (truthy(this.eval(branch.cond, scope))) return this.execBlock(branch.body, scope);
      }
      return node.otherwise ? this.execBlock(node.otherwise, scope) : undefined;
    }

    execRepeat(node, scope) {
      const n = this.eval(node.count, scope);
      if (typeof n !== 'number' || !Number.isFinite(n)) fail(`'gentag' skal have et tal, men fik ${an(n)}`, node);
      if (!Number.isInteger(n) || n < 0) fail(`Antallet af gange skal være et helt tal, der ikke er negativt – ikke ${formatNumber(n)}`, node);
      for (let i = 0; i < n; i++) {
        this.tick(node);
        const signal = this.execBlock(node.body, scope);
        if (signal === BREAK) break;
        if (signal instanceof ReturnSignal) return signal;
      }
      return undefined;
    }

    execWhile(node, scope) {
      while (truthy(this.eval(node.cond, scope))) {
        this.tick(node);
        const signal = this.execBlock(node.body, scope);
        if (signal === BREAK) break;
        if (signal instanceof ReturnSignal) return signal;
      }
      return undefined;
    }

    execForRange(node, scope) {
      const from = this.eval(node.from, scope);
      const to = this.eval(node.to, scope);
      if (typeof from !== 'number' || !Number.isFinite(from)) fail(`'fra' skal være et tal, men er ${an(from)}`, node);
      if (typeof to !== 'number' || !Number.isFinite(to)) fail(`'til' skal være et tal, men er ${an(to)}`, node);
      const step = node.step ? this.eval(node.step, scope) : (to >= from ? 1 : -1);
      if (typeof step !== 'number' || !Number.isFinite(step)) fail(`'trin' skal være et tal, men er ${an(step)}`, node);
      if (step === 0) fail("'trin' må ikke være 0 – så ville løkken aldrig blive færdig", node);
      const slack = Math.abs(step) * 1e-9;
      for (let k = 0; ; k++) {
        // Vi regner hver værdi ud fra starten, så små regnefejl ikke hober sig op.
        const v = clean(from + k * step);
        if (step > 0 ? v > to + slack : v < to - slack) break;
        this.tick(node);
        this.assign(node.name, v, scope);
        const signal = this.execBlock(node.body, scope);
        if (signal === BREAK) break;
        if (signal instanceof ReturnSignal) return signal;
      }
      return undefined;
    }

    execForEach(node, scope) {
      const coll = this.eval(node.iterable, scope);
      let items;
      if (Array.isArray(coll)) items = coll.slice();
      else if (typeof coll === 'string') items = Array.from(coll);
      else fail(`'for hver' kan kun gå en liste eller en tekst igennem, men fik ${an(coll)}`, node);
      for (const item of items) {
        this.tick(node);
        this.assign(node.name, item, scope);
        const signal = this.execBlock(node.body, scope);
        if (signal === BREAK) break;
        if (signal instanceof ReturnSignal) return signal;
      }
      return undefined;
    }

    execSet(node, scope) {
      const target = node.target;
      let value = this.eval(node.value, scope);
      const compound = node.op !== '=';

      if (target.type === 'Var') {
        if (compound) {
          const owner = scope.find(target.name);
          if (!owner || owner.isBuiltin) {
            fail(`'${target.name}' har ikke fået en værdi endnu, så jeg kan ikke bruge '${node.op}'. Skriv først: sæt ${target.name} = 0`, target);
          }
          value = this.arith(node.op[0], owner.vars.get(target.name), value, node);
        }
        this.assign(target.name, value, scope);
        return;
      }

      const container = this.eval(target.object, scope);
      const index = this.eval(target.index, scope);
      if (typeof container === 'string') fail('En tekst kan ikke ændres bogstav for bogstav. Lav en ny tekst i stedet', target);
      if (!Array.isArray(container)) fail(`Kun lister kan ændres med [ ], men dette er ${an(container)}`, target);
      const i = this.checkIndex(container, index, target, 'liste');
      if (compound) value = this.arith(node.op[0], container[i], value, node);
      container[i] = value;
    }

    checkIndex(items, index, node, kind) {
      const what = kind === 'tekst' ? 'teksten' : 'listen';
      if (typeof index !== 'number' || !Number.isInteger(index)) {
        fail(`En plads skal være et helt tal, men fik ${typeof index === 'number' ? formatNumber(index) : an(index)}`, node);
      }
      const i = index < 0 ? items.length + index : index;
      if (i < 0 || i >= items.length) {
        if (!items.length) fail(`Plads ${index} findes ikke, fordi ${what} er tom`, node);
        const unit = kind === 'tekst' ? 'tegn' : (items.length === 1 ? 'element' : 'elementer');
        fail(`Plads ${index} findes ikke. ${what[0].toUpperCase() + what.slice(1)} har ${items.length} ${unit}, så pladserne går fra 0 til ${items.length - 1}`, node);
      }
      return i;
    }

    // ── Udtryk ─────────────────────────────────────────────────────────

    unknownMessage(name, scope, isCall) {
      const hint = ENGLISH_HINTS.get(name);
      if (hint) return `Hygge er på dansk: skriv '${hint}' i stedet for '${name}'`;
      const names = new Set(isCall ? [] : ['sandt', 'falsk', 'intet']);
      for (let s = scope; s; s = s.parent) for (const k of s.vars.keys()) names.add(k);
      const guess = closest(name, names);
      if (guess) return `Jeg kender ikke '${name}'. Mente du '${guess}'?`;
      if (isCall) return `Der findes ingen funktion, der hedder '${name}'. Du kan lave den med: funktion ${name}() { ... }`;
      return `Jeg kender ikke '${name}'. Har du husket at give den en værdi først, fx: sæt ${name} = 0`;
    }

    eval(node, scope) {
      switch (node.type) {
        case 'Lit': return node.value;
        case 'Var': return this.evalVar(node, scope);
        case 'Binary': return this.binary(node.op, this.eval(node.left, scope), this.eval(node.right, scope), node);
        case 'Call': return this.evalCall(node, scope);
        case 'Index': return this.evalIndex(node, scope);
        case 'List': return this.evalList(node, scope);
        case 'Logical': return this.evalLogical(node, scope);
        case 'Not': return !truthy(this.eval(node.arg, scope));
        case 'Neg': return this.evalNeg(node, scope);
        case 'FuncLit': return new UserFunction(null, node.params, node.body, scope);
        default: return fail(`Ukendt udtryk: ${node.type}`, node);
      }
    }

    evalVar(node, scope) {
      const owner = scope.find(node.name);
      if (!owner) fail(this.unknownMessage(node.name, scope, false), node);
      return owner.vars.get(node.name);
    }

    evalList(node, scope) {
      const items = [];
      for (const item of node.items) items.push(this.eval(item, scope));
      return items;
    }

    evalIndex(node, scope) {
      const obj = this.eval(node.object, scope);
      const index = this.eval(node.index, scope);
      if (Array.isArray(obj)) return obj[this.checkIndex(obj, index, node, 'liste')];
      if (typeof obj === 'string') {
        const chars = Array.from(obj);
        return chars[this.checkIndex(chars, index, node, 'tekst')];
      }
      return fail(`Du kan kun bruge [ ] på en liste eller en tekst, men dette er ${an(obj)}`, node);
    }

    evalLogical(node, scope) {
      const left = truthy(this.eval(node.left, scope));
      if (node.op === 'og') return left ? truthy(this.eval(node.right, scope)) : false;
      return left ? true : truthy(this.eval(node.right, scope));
    }

    evalNeg(node, scope) {
      const v = this.eval(node.arg, scope);
      if (typeof v !== 'number') fail(`Minus foran virker kun på tal, men dette er ${an(v)}`, node);
      return -v;
    }

    evalCall(node, scope) {
      let callee;
      if (node.callee.type === 'Var') {
        const owner = scope.find(node.callee.name);
        if (!owner) fail(this.unknownMessage(node.callee.name, scope, true), node.callee);
        callee = owner.vars.get(node.callee.name);
      } else {
        callee = this.eval(node.callee, scope);
      }
      const args = [];
      for (const arg of node.args) args.push(this.eval(arg, scope));
      if (callee instanceof UserFunction) return this.callUser(callee, args, node);
      if (callee instanceof Builtin) return this.callBuiltin(callee, args, node);
      if (node.callee.type === 'Var') return fail(`'${node.callee.name}' er ikke en funktion – det er ${an(callee)}`, node);
      return fail(`Dette er ${an(callee)} og ikke en funktion, så det kan ikke kaldes med ( )`, node);
    }

    binary(op, l, r, node) {
      switch (op) {
        case '=': return equal(l, r);
        case '!=': return !equal(l, r);
        case '<': case '>': case '<=': case '>=': {
          let c;
          if (typeof l === 'number' && typeof r === 'number') c = l < r ? -1 : l > r ? 1 : 0;
          else if (typeof l === 'string' && typeof r === 'string') c = l.localeCompare(r, 'da');
          else fail(`Kan ikke sammenligne ${an(l)} med ${an(r)} med '${op}'`, node);
          if (op === '<') return c < 0;
          if (op === '>') return c > 0;
          if (op === '<=') return c <= 0;
          return c >= 0;
        }
        default:
          return this.arith(op, l, r, node);
      }
    }

    arith(op, l, r, node) {
      if (op === '+') {
        if (typeof l === 'number' && typeof r === 'number') return l + r;
        if (typeof l === 'string' || typeof r === 'string') return format(l) + format(r);
        if (Array.isArray(l) && Array.isArray(r)) return l.concat(r);
        return fail(`Kan ikke lægge ${an(l)} og ${an(r)} sammen`, node);
      }
      if (op === '*' && (typeof l === 'string' || typeof r === 'string')) {
        const text = typeof l === 'string' ? l : r;
        const n = typeof l === 'string' ? r : l;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) fail('En tekst kan kun ganges med et helt tal, der ikke er negativt', node);
        if (text.length * n > 1000000) fail('Teksten bliver for lang', node);
        return text.repeat(n);
      }
      if (typeof l !== 'number' || typeof r !== 'number') {
        fail(`'${op}' virker kun med tal, men her er ${an(l)} og ${an(r)}`, node);
      }
      switch (op) {
        case '-': return l - r;
        case '*': return l * r;
        case '/':
          if (r === 0) fail('Du kan ikke dividere med 0', node);
          return l / r;
        case '%':
          if (r === 0) fail('Du kan ikke finde resten ved division med 0', node);
          return ((l % r) + r) % r;
        case '^':
          return l ** r;
        default:
          return fail(`Ukendt regnetegn '${op}'`, node);
      }
    }

    callBuiltin(fn, args, node) {
      if (args.length < fn.min || args.length > fn.max) fail(arityText(fn.name, fn.min, fn.max, args.length), node);
      try {
        const result = fn.impl.apply(this, args);
        return result === undefined ? null : result;
      } catch (e) {
        // Fejl inde i en indbygget funktion får linjenummeret fra kaldet.
        if (e instanceof HyggeFejl && e.line == null) {
          e.line = node.line;
          e.col = node.col;
        }
        throw e;
      }
    }

    callUser(fn, args, node) {
      const name = fn.name || 'funktionen';
      if (args.length !== fn.params.length) fail(arityText(name, fn.params.length, fn.params.length, args.length), node);
      if (this.depth >= LIMITS.depth) {
        fail(`'${name}' kalder sig selv for mange gange (over ${LIMITS.depth}). Mangler der en betingelse, der får den til at stoppe?`, node);
      }
      // Hvert kald får sit eget sted til variabler, der peger videre ud til der, hvor funktionen blev lavet.
      const local = new Scope(fn.closure);
      for (let i = 0; i < args.length; i++) local.vars.set(fn.params[i], args[i]);
      this.hoist(fn.body, local);
      this.depth++;
      const signal = this.execBlock(fn.body, local);
      this.depth--;
      return signal instanceof ReturnSignal ? signal.value : null;
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  Det offentlige værktøj
  // ════════════════════════════════════════════════════════════════════

  function describeError(e, interp) {
    const fallbackLine = interp && interp.current ? interp.current.line : null;
    if (e instanceof HyggeFejl) return { message: e.message, line: e.line ?? fallbackLine, col: e.col };
    if (e instanceof RangeError) {
      return {
        message: 'Programmet gik for dybt ned i sig selv. Kalder en funktion måske sig selv uden at stoppe?',
        line: fallbackLine,
        col: null,
      };
    }
    return { message: `Der skete en uventet fejl i Hygge: ${e && e.message ? e.message : e}`, line: fallbackLine, col: null };
  }

  /**
   * Kører et Hygge-program.
   *
   * options:
   *   answers   – svar til spørg(), i rækkefølge
   *   ask       – funktion(spørgsmål) → svar, bruges når answers er opbrugt
   *   seed      – tal, der gør tilfældig() forudsigelig
   *   onOutput  – funktion, der kaldes for hver linje, programmet skriver
   *   maxSteps  – hvor mange skridt programmet højst må tage
   *
   * Giver { output, drawing, turtle, error, waitingFor, steps } tilbage.
   */
  function run(source, options = {}) {
    const result = { output: [], drawing: [], turtle: { x: 0, y: 0, angle: 0 }, error: null, waitingFor: null, steps: 0 };
    let interp = null;
    try {
      const program = parse(source);
      interp = new Interpreter(options);
      result.output = interp.output;
      result.drawing = interp.drawing;
      interp.runProgram(program);
    } catch (e) {
      if (e instanceof NeedInput) result.waitingFor = { question: e.question };
      else result.error = describeError(e, interp);
    }
    if (interp) {
      const t = interp.turtle;
      result.steps = interp.steps;
      result.turtle = { x: t.x, y: t.y, angle: t.angle };
    }
    return result;
  }

  return {
    version: '1.0.0',
    run,
    tokenize,
    parse,
    format,
    typeName,
    HyggeFejl,
    KEYWORDS: KEYWORDS.slice(),
    CONTEXT_WORDS: CONTEXT_WORDS.slice(),
    COLORS: Object.assign({}, COLORS),
    LIMITS: Object.assign({}, LIMITS),
    BUILTINS: BUILTINS.map(({ name, group, params, description }) => ({ name, group, params, description })),
  };
});
