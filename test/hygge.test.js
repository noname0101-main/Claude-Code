'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Hygge = require('../hygge');
const EKSEMPLER = require('../eksempler');

/** Kører et program og giver de skrevne linjer tilbage. Fejler testen, hvis programmet fejler. */
function lines(source, options) {
  const result = Hygge.run(source, options);
  if (result.error) throw new Error(`Uventet fejl på linje ${result.error.line}: ${result.error.message}`);
  return result.output.filter((e) => e.type === 'tekst').map((e) => e.text);
}

/** Kører et program, der skal fejle, og giver fejlen tilbage. */
function error(source, options) {
  const result = Hygge.run(source, options);
  assert.ok(result.error, 'Programmet skulle have fejlet, men gjorde det ikke');
  return result.error;
}

test('lexeren kender nøgleord, navne med æøå, tal og tekst', () => {
  const tokens = Hygge.tokenize('sæt størrelse = 3.5 + "blåbær"');
  assert.deepEqual(
    tokens.map((t) => [t.type, t.value]),
    [['kw', 'sæt'], ['ident', 'størrelse'], ['op', '='], ['num', 3.5], ['op', '+'], ['str', 'blåbær'], ['nl', '\n'], ['eof', '']],
  );
});

test('lexeren ignorerer linjeskift inde i parenteser og forstår krøllede anførselstegn', () => {
  assert.deepEqual(lines('skriv længde([1,\n  2,\n  3])'), ['3']);
  assert.deepEqual(lines('skriv “Hej fra telefonen”'), ['Hej fra telefonen']);
});

test('skriv og regning følger matematikkens regler', () => {
  assert.deepEqual(lines('skriv "Hej verden!"'), ['Hej verden!']);
  assert.deepEqual(lines('skriv 2 + 3 * 4\nskriv (2 + 3) * 4\nskriv 2 ^ 3 ^ 2\nskriv -2 ^ 2'), ['14', '20', '512', '-4']);
  assert.deepEqual(lines('skriv 7 / 2, 10 % 3, -7 % 3'), ['3.5 1 2']);
  assert.deepEqual(lines('skriv 0.1 + 0.2'), ['0.3']);
  assert.deepEqual(lines('skriv'), ['']);
});

test('variabler, sæt og +=', () => {
  assert.deepEqual(lines('sæt x = 5\nsæt x += 3\nsæt x *= 2\nsæt x -= 1\nskriv x'), ['15']);
  assert.deepEqual(lines('sæt navn = "Ida"\nsæt navn += "!"\nskriv navn'), ['Ida!']);
});

test('tekst kan lægges sammen med tal og ganges', () => {
  assert.deepEqual(lines('skriv "Alder: " + 12\nskriv "ha" * 3'), ['Alder: 12', 'hahaha']);
});

test('hvis, ellers hvis og ellers – også med ellers på en ny linje', () => {
  const program = (n) => `sæt t = ${n}
hvis t < 0 {
    skriv "frost"
}
ellers hvis t < 10 {
    skriv "koldt"
} ellers {
    skriv "lunt"
}`;
  assert.deepEqual(lines(program(-3)), ['frost']);
  assert.deepEqual(lines(program(5)), ['koldt']);
  assert.deepEqual(lines(program(15)), ['lunt']);
});

test('sammenligning med = og ==, og, eller og ikke', () => {
  assert.deepEqual(lines('skriv 3 = 3, 3 == 4, 3 != 4, "a" < "b", "æ" > "z"'), ['sandt falsk sandt sandt sandt']);
  assert.deepEqual(lines('skriv sandt og falsk, sandt eller falsk, ikke falsk, ikke 1 = 2'), ['falsk sandt sandt sandt']);
  assert.deepEqual(lines('skriv [1, [2, "a"]] = [1, [2, "a"]]'), ['sandt']);
});

test('gentag, mens og for-løkker', () => {
  assert.deepEqual(lines('gentag 3 gange {\n skriv "x"\n}'), ['x', 'x', 'x']);
  assert.deepEqual(lines('sæt n = 3\nmens n > 0 {\n skriv n\n sæt n -= 1\n}'), ['3', '2', '1']);
  assert.deepEqual(lines('for i fra 1 til 3 {\n skriv i\n}'), ['1', '2', '3']);
  assert.deepEqual(lines('for i fra 3 til 1 {\n skriv i\n}'), ['3', '2', '1']);
  assert.deepEqual(lines('for i fra 0 til 1 trin 0.25 {\n skriv i\n}'), ['0', '0.25', '0.5', '0.75', '1']);
  assert.deepEqual(lines('for hver b i "æøå" {\n skriv b\n}'), ['æ', 'ø', 'å']);
});

test('stop og fortsæt', () => {
  const source = `for i fra 1 til 10 {
    hvis i % 2 = 0 {
        fortsæt
    }
    hvis i > 7 {
        stop
    }
    skriv i
}`;
  assert.deepEqual(lines(source), ['1', '3', '5', '7']);
});

test('lister: plads, negativ plads, ændring og indbyggede funktioner', () => {
  const source = `sæt l = ["pære", "æble", "banan"]
tilføj(l, "ananas")
skriv l[0], l[-1], længde(l)
sæt l[1] = "kiwi"
skriv l
skriv sorter(["øl", "ål", "æg", "zebra"])
skriv fjern(l), l
indsæt(l, 0, "først")
skriv l, indeholder(l, "kiwi"), position(l, "kiwi")
skriv omvendt([1, 2, 3]), sum([1, 2, 3]), mindst(4, 9, 2), størst([4, 9, 2])`;
  assert.deepEqual(lines(source), [
    'pære ananas 4',
    '["pære", "kiwi", "banan", "ananas"]',
    '["zebra", "æg", "øl", "ål"]',
    'ananas ["pære", "kiwi", "banan"]',
    '["først", "pære", "kiwi", "banan"] sandt 2',
    '[3, 2, 1] 6 2 9',
  ]);
});

test('funktioner: returner, rekursion, closures og funktioner før de er defineret', () => {
  const source = `skriv dobbelt(21)
funktion dobbelt(x) {
    returner x * 2
}
funktion fakultet(n) {
    hvis n <= 1 {
        returner 1
    }
    returner n * fakultet(n - 1)
}
skriv fakultet(10)
funktion lav_tæller() {
    sæt antal = 0
    returner funktion() {
        sæt antal += 1
        returner antal
    }
}
sæt tæl = lav_tæller()
tæl()
tæl()
skriv tæl()
funktion intet_svar() {
    sæt x = 1
}
skriv intet_svar()`;
  assert.deepEqual(lines(source), ['42', '3628800', '3', 'intet']);
});

test('variabler i en funktion er lokale, men den kan ændre globale variabler', () => {
  const source = `sæt point = 0
funktion giv_point(n) {
    sæt point += n
    sæt lokal = n
}
giv_point(5)
giv_point(2)
skriv point
skriv type(point)`;
  assert.deepEqual(lines(source), ['7', 'tal']);
  assert.match(error('funktion f() {\n sæt lokal = 1\n}\nf()\nskriv lokal').message, /Jeg kender ikke 'lokal'/);
});

test('tekstfunktioner og typer', () => {
  const source = `skriv tal("3,5") + 1, tal(" 42 ")
skriv type("hej"), type([1]), type(sandt), type(intet), type(skriv_ikke)
skriv store_bogstaver("blåbær"), små_bogstaver("ÆBLE")
skriv opdel("en to  tre"), opdel("a,b", ",")
skriv saml(["a", "b", "c"], "-"), erstat("hej hej", "hej", "dav")
skriv afrund(3.14159, 2), afrund(2.5), afrund(-2.5), afrund(1.005, 2)
skriv tekst([1, "to"]) + "!"
funktion skriv_ikke() {
}`;
  assert.deepEqual(lines(source), [
    '4.5 42',
    'tekst liste sandhedsværdi intet funktion',
    'BLÅBÆR æble',
    '["en", "to", "tre"] ["a", "b"]',
    'a-b-c dav dav',
    '3.14 3 -3 1.01',
    '[1, "to"]!',
  ]);
});

test('tilfældig er forudsigelig med samme frø', () => {
  const source = 'skriv tilfældig(1, 1000), tilfældig(6), tilfældig(["a", "b", "c"])';
  assert.deepEqual(lines(source, { seed: 42 }), lines(source, { seed: 42 }));
  for (let seed = 0; seed < 50; seed++) {
    const [a, b] = lines('skriv tilfældig(1, 6)\nskriv tilfældig(3)', { seed }).map(Number);
    assert.ok(a >= 1 && a <= 6 && Number.isInteger(a));
    assert.ok(b >= 1 && b <= 3 && Number.isInteger(b));
  }
});

test('spørg venter på svar og bruger svarene i rækkefølge', () => {
  const source = 'sæt navn = spørg("Hvad hedder du?")\nskriv "Hej", navn';
  const waiting = Hygge.run(source);
  assert.deepEqual(waiting.waitingFor, { question: 'Hvad hedder du?' });
  assert.equal(waiting.error, null);

  const done = Hygge.run(source, { answers: ['Ida'] });
  assert.equal(done.waitingFor, null);
  assert.deepEqual(done.output, [
    { type: 'svar', question: 'Hvad hedder du?', answer: 'Ida' },
    { type: 'tekst', text: 'Hej Ida', line: 2 },
  ]);

  assert.deepEqual(lines(source, { ask: () => 'Malik' }), ['Hej Malik']);
});

test('skildpadden tegner streger og kommer tilbage efter en firkant', () => {
  const result = Hygge.run('gentag 4 gange {\n fremad(100)\n drej_højre(90)\n}');
  assert.equal(result.error, null);
  assert.equal(result.drawing.length, 4);
  assert.deepEqual(result.drawing[0], { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 100, color: null, width: 2 });
  assert.deepEqual(result.drawing[1].x2, 100);
  assert.deepEqual(result.turtle, { x: 0, y: 0, angle: 0 });

  const penUp = Hygge.run('pen_op()\nfremad(50)\npen_ned()\nfarve("blå")\ntykkelse(4)\nfremad(10)\ncirkel(5, sandt)\nbaggrund(10, 20, 30)');
  assert.equal(penUp.error, null);
  assert.deepEqual(penUp.drawing.map((d) => d.kind), ['line', 'circle', 'background']);
  assert.equal(penUp.drawing[0].y1, 50);
  assert.equal(penUp.drawing[0].color, Hygge.COLORS.blå);
  assert.equal(penUp.drawing[1].fill, true);
  assert.equal(penUp.drawing[2].color, 'rgb(10, 20, 30)');
  assert.match(error('farve("regnbue")').message, /Jeg kender ikke farven "regnbue"/);
});

test('fejl har linjenummer og en forklaring på dansk', () => {
  const unknown = error('skriv 1\nskriv alder');
  assert.equal(unknown.line, 2);
  assert.match(unknown.message, /Jeg kender ikke 'alder'/);

  assert.match(error('sæt alder = 3\nskriv aldre').message, /Mente du 'alder'\?/);
  assert.match(error('skrv "hej"').message, /Mente du 'skriv'\?/);
  assert.match(error('print("hej")').message, /skriv 'skriv' i stedet for 'print'/);
  assert.match(error('x = 5').message, /Brug 'sæt'/);
  assert.match(error('sæt x = 1\nx += 1').message, /Brug 'sæt'/);
  assert.match(error('skriv 1 / 0').message, /dividere med 0/);
  assert.match(error('sæt l = [1, 2]\nskriv l[5]').message, /Plads 5 findes ikke. Listen har 2 elementer, så pladserne går fra 0 til 1/);
  assert.match(error('skriv længde(1, 2)').message, /længde\(\) skal have 1 værdi, men fik 2/);
  assert.match(error('skriv "a" - 1').message, /'-' virker kun med tal, men her er en tekst og et tal/);
  assert.match(error('skriv tal("abc")').message, /Kan ikke lave "abc" om til et tal/);
  assert.match(error('stop').message, /kun bruges inde i en løkke/);
  assert.match(error('returner 5').message, /kun bruges inde i en funktion/);
  assert.match(error('skriv "hej').message, /afsluttende anførselstegn/);
  assert.match(error('"hej"').message, /regner en værdi ud, men gør ikke noget/);
  assert.match(error('hvis 1 < 2 < 3 {\n}').message, /tre ting på én gang/);
  assert.match(error('skriv 1 2').message, /Mangler der et komma/);
  assert.match(error('hils("Ida")').message, /Der findes ingen funktion, der hedder 'hils'/);
  assert.match(error('sæt x = 5\nx()').message, /'x' er ikke en funktion – det er et tal/);
  assert.match(error('skriv 3 && 4').message, /Brug ordet 'og'/);
  assert.match(error('hvis 1 < 2:\n skriv 1').message, /bruger \{ og \}/);
});

test('manglende parenteser og klammer bliver fundet', () => {
  const missingBrace = error('skriv 1\nhvis sandt {\n    skriv 2\n');
  assert.equal(missingBrace.line, 2);
  assert.match(missingBrace.message, /mangler en afsluttende '\}'/);

  const missingParen = error('skriv længde([1, 2]\nskriv 3');
  assert.equal(missingParen.line, 1);
  assert.match(missingParen.message, /'\(' på linje 1 bliver aldrig lukket/);

  assert.match(error('}').message, /'\}' for meget/);
  assert.match(error('gentag 3 {\n}').message, /Skriv 'gange'/);
  assert.match(error('for i i [1, 2] {\n}').message, /for hver i i/);
});

test('uendelige løkker og uendelig rekursion stopper med en venlig fejl', () => {
  const loop = error('sæt n = 0\nmens sandt {\n    sæt n += 1\n}', { maxSteps: 10000 });
  assert.match(loop.message, /kørte for længe/);
  assert.ok(loop.line === 2 || loop.line === 3);

  assert.match(error('mens sandt {\n}', { maxSteps: 1000 }).message, /kørte for længe/);

  const recursion = error('funktion f(n) {\n    returner f(n + 1)\n}\nskriv f(1)');
  assert.match(recursion.message, /kalder sig selv for mange gange|for dybt/);
});

test('rekursion kan gå dybt nok til almindelige programmer', () => {
  const source = `funktion tæl(n) {
    hvis n = 0 {
        returner 0
    }
    returner 1 + tæl(n - 1)
}
skriv tæl(${Hygge.LIMITS.depth - 1})`;
  assert.deepEqual(lines(source), [String(Hygge.LIMITS.depth - 1)]);
});

test('alle eksemplerne kører uden fejl', () => {
  // Gæt-et-tal får svarene 1, 2, 3 ... og rammer derfor altid tallet til sidst.
  const answers = Array.from({ length: 100 }, (_, i) => String(i + 1));
  for (const eksempel of EKSEMPLER) {
    const result = Hygge.run(eksempel.kode, { answers, seed: 7 });
    assert.equal(result.error, null, `${eksempel.titel}: ${result.error && result.error.message}`);
    assert.equal(result.waitingFor, null, `${eksempel.titel} venter stadig på svar`);
    assert.ok(result.output.length + result.drawing.length > 0, `${eksempel.titel} gjorde ingenting`);
  }
});
