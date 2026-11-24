#!/usr/bin/env node
/*
 * Kør Hygge-programmer i terminalen.
 *
 *   node cli.js mit-program.hygge     kører en fil
 *   node cli.js --eksempel gæt        kører et af de indbyggede eksempler
 *   node cli.js --eksempler           viser alle eksemplerne
 */
'use strict';

const fs = require('fs');
const Hygge = require('./hygge');
const EKSEMPLER = require('./eksempler');

/** Læser én linje fra tastaturet og venter, til brugeren trykker Enter. */
function readLine() {
  const bytes = [];
  const buffer = Buffer.alloc(1);
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buffer, 0, 1, null);
    } catch (e) {
      if (e.code === 'EAGAIN') continue;
      if (e.code === 'EOF') n = 0;
      else throw e;
    }
    if (n === 0) return bytes.length ? Buffer.from(bytes).toString('utf8') : null;
    if (buffer[0] === 0x0a) return Buffer.from(bytes).toString('utf8').replace(/\r$/, '');
    bytes.push(buffer[0]);
  }
}

function usage() {
  console.log('Brug:');
  console.log('  node cli.js <fil.hygge>          kør et program');
  console.log('  node cli.js --eksempel <navn>    kør et eksempel');
  console.log('  node cli.js --eksempler          vis alle eksempler');
}

const args = process.argv.slice(2);
let source;

if (args[0] === '--eksempler') {
  for (const e of EKSEMPLER) console.log(`  ${e.id.padEnd(12)} ${e.titel}`);
  process.exit(0);
} else if (args[0] === '--eksempel') {
  const eksempel = EKSEMPLER.find((e) => e.id === args[1]);
  if (!eksempel) {
    console.error(`Der findes intet eksempel, der hedder "${args[1] || ''}". Skriv --eksempler for at se dem alle.`);
    process.exit(1);
  }
  source = eksempel.kode;
} else if (args[0] && !args[0].startsWith('-')) {
  try {
    source = fs.readFileSync(args[0], 'utf8');
  } catch (e) {
    console.error(`Kunne ikke læse filen "${args[0]}".`);
    process.exit(1);
  }
} else {
  usage();
  process.exit(args.length ? 1 : 0);
}

const result = Hygge.run(source, {
  onOutput(entry) {
    if (entry.type === 'tekst') console.log(entry.text);
  },
  ask(question) {
    process.stdout.write(question ? question + ' ' : '> ');
    const answer = readLine();
    return answer === null ? '' : answer;
  },
});

if (result.drawing.length) {
  console.log('\n(Programmet tegnede noget. Åbn index.html i en browser for at se tegningen.)');
}
if (result.error) {
  const where = result.error.line ? `Fejl på linje ${result.error.line}` : 'Fejl';
  console.error(`\n${where}: ${result.error.message}`);
  process.exit(1);
}
