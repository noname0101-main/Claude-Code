#!/usr/bin/env node
'use strict';

/*
 * Opsætning af Opslag:  npm run opsaet
 *
 * Tjekker din OpenRouter-nøgle og spørger, hvilken model AI'en skal bruge,
 * om den må søge på hele nettet, og hvor meget en samtale højst må koste.
 * Svarene bliver gemt i indstillinger.json. Du kan køre den igen når som helst.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { tjekNoegle, hentModeller } = require('./openrouter');
const { STANDARD_MODEL, UDVALGTE_SIDER } = require('./agent');

const FIL = path.join(__dirname, 'indstillinger.json');

const FORSLAG = [
  { id: STANDARD_MODEL, tekst: 'Den klogeste. Bedst til svære spørgsmål.' },
  { id: 'anthropic/claude-sonnet-5.5', tekst: 'Hurtig og god. Cirka halv pris.' },
  { id: 'anthropic/claude-haiku-5.5', tekst: 'Meget billig og hurtig. Fin til enkle opslag.' },
];

function hentGemte() {
  try { return JSON.parse(fs.readFileSync(FIL, 'utf8')); } catch (e) { return {}; }
}

const prisTekst = (m) => {
  const ind = Number(m.pricing && m.pricing.prompt) * 1e6;
  const ud = Number(m.pricing && m.pricing.completion) * 1e6;
  if (!Number.isFinite(ind) || !Number.isFinite(ud)) return 'ukendt pris';
  if (ind === 0 && ud === 0) return 'gratis';
  return `${ind.toLocaleString('da-DK')} / ${ud.toLocaleString('da-DK')} dollar pr. million tokens ind / ud`;
};

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.log('Du mangler en OpenRouter-nøgle.\n');
    console.log('1. Lav en konto og en nøgle på https://openrouter.ai/settings/keys');
    console.log('2. Køb credits på https://openrouter.ai/settings/credits (eller brug en gratis model)');
    console.log('3. Sæt nøglen i terminalen og kør opsætningen igen:');
    console.log('     macOS/Linux:  export OPENROUTER_API_KEY="din-nøgle"');
    console.log('     Windows:      setx OPENROUTER_API_KEY "din-nøgle"   (åbn så en ny terminal)');
    process.exit(1);
  }

  process.stdout.write('Tjekker din nøgle … ');
  const noegle = await tjekNoegle({ apiKey });
  const rest = noegle && typeof noegle.limit_remaining === 'number' ? ` (${noegle.limit_remaining.toLocaleString('da-DK')} dollar tilbage på nøglen)` : '';
  console.log(`den virker${rest}.`);

  process.stdout.write('Henter listen over modeller … ');
  const modeller = await hentModeller();
  const medVaerktoejer = new Map(modeller.filter((m) => (m.supported_parameters || []).includes('tools')).map((m) => [m.id, m]));
  console.log(`${modeller.length} modeller.\n`);

  const gemte = hentGemte();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // 1. Model
    const forslag = FORSLAG.filter((f) => medVaerktoejer.has(f.id));
    console.log('Hvilken model skal Opslag bruge?\n');
    forslag.forEach((f, i) => console.log(`  ${i + 1}. ${f.id}\n     ${f.tekst} ${prisTekst(medVaerktoejer.get(f.id))}`));
    console.log(`  ${forslag.length + 1}. Skriv selv et model-id fra https://openrouter.ai/models (fx en gratis model, der ender på ":free")\n`);
    const nuvaerende = gemte.model || STANDARD_MODEL;
    let model = null;
    while (!model) {
      const svar = (await rl.question(`Dit valg [${nuvaerende}]: `)).trim();
      if (!svar) model = nuvaerende;
      else if (/^\d+$/.test(svar) && Number(svar) >= 1 && Number(svar) <= forslag.length) model = forslag[Number(svar) - 1].id;
      else if (/^\d+$/.test(svar)) model = (await rl.question('Model-id: ')).trim() || null;
      else model = svar;
      if (model && !medVaerktoejer.has(model)) {
        console.log(modeller.some((m) => m.id === model)
          ? `${model} kan ikke bruge værktøjer, og det skal Opslag bruge. Vælg en anden.`
          : `OpenRouter kender ikke ${model}. Tjek stavningen på https://openrouter.ai/models.`);
        model = null;
      }
    }
    console.log(`→ ${model}: ${prisTekst(medVaerktoejer.get(model))}\n`);

    // 2. Hjemmesider
    console.log('Må Opslag søge på hele internettet?');
    console.log(`  j = Ja, alle sider. Den finder mest.`);
    console.log(`  n = Nej, kun ${UDVALGTE_SIDER.length} udvalgte sider som wikipedia.org, dr.dk, borger.dk og dmi.dk (listen står i agent.js).`);
    const standardSider = gemte.alleSider === false ? 'n' : 'j';
    let alleSider = null;
    while (alleSider === null) {
      const svar = ((await rl.question(`Dit valg (j/n) [${standardSider}]: `)).trim().toLowerCase() || standardSider);
      if (svar === 'j' || svar === 'ja') alleSider = true;
      else if (svar === 'n' || svar === 'nej') alleSider = false;
    }

    // 3. Budget
    const standardBudget = Number(gemte.budgetDollar) > 0 ? Number(gemte.budgetDollar) : 1;
    let budgetDollar = null;
    while (budgetDollar === null) {
      const svar = (await rl.question(`\nHvor mange dollar må én samtale højst koste? [${standardBudget.toLocaleString('da-DK')}]: `)).trim().replace(',', '.');
      const tal = svar ? Number(svar) : standardBudget;
      if (Number.isFinite(tal) && tal > 0) budgetDollar = tal;
      else console.log('Skriv et tal større end 0, fx 0,5 eller 2.');
    }

    fs.writeFileSync(FIL, JSON.stringify({ model, alleSider, budgetDollar }, null, 2) + '\n');
    console.log(`\nGemt i ${path.relative(process.cwd(), FIL) || FIL}. Start Opslag med:  npm start`);
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(`\n${e && e.name === 'OpenRouterFejl' ? e.message : (e && e.stack) || e}`);
  process.exit(1);
});
