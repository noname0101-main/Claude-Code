#!/usr/bin/env node
'use strict';

/*
 * Opsætning af Opslag. Kør den én gang (og igen, hvis du ændrer agent.js):
 *
 *   npm run opsaet
 *
 * Den opretter et miljø og en agent hos Anthropic og gemmer deres id'er i
 * indstillinger.json. Kører du den igen, bliver agenten opdateret i stedet
 * for at blive oprettet forfra.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const Anthropic = require('@anthropic-ai/sdk');
const { agentIndstillinger, miljoeIndstillinger, UDVALGTE_SIDER } = require('./agent');

const FIL = path.join(__dirname, 'indstillinger.json');

function hentIndstillinger() {
  try {
    return JSON.parse(fs.readFileSync(FIL, 'utf8'));
  } catch (e) {
    return {};
  }
}

async function spoergOmNet(tidligere) {
  console.log('\nMå Opslag søge på hele internettet?\n');
  console.log('  j = Ja, alle sider. AI\'en finder mest, men maskinen, hvor den regner,');
  console.log('      får også fri adgang til internettet. Læg aldrig hemmeligheder derind.');
  console.log(`  n = Nej, kun ${UDVALGTE_SIDER.length} udvalgte sider, fx wikipedia.org, dr.dk, borger.dk og dmi.dk.`);
  console.log('      Mere sikkert, men den finder færre ting. Listen står i agent.js.\n');
  const standard = tidligere === undefined ? '' : (tidligere ? 'j' : 'n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const svar = (await rl.question(`Dit valg (j/n)${standard ? ` [${standard}]` : ''}: `)).trim().toLowerCase() || standard;
      if (svar === 'j' || svar === 'ja') return true;
      if (svar === 'n' || svar === 'nej') return false;
      console.log('Skriv j eller n.');
    }
  } finally {
    rl.close();
  }
}

function forklarFejl(e) {
  if (e instanceof Anthropic.AuthenticationError) {
    return [
      'Anthropic kunne ikke genkende din API-nøgle.',
      'Lav en nøgle på https://console.anthropic.com/settings/keys og sæt den, før du kører programmet:',
      '  macOS/Linux:  export ANTHROPIC_API_KEY="din-nøgle"',
      '  Windows:      setx ANTHROPIC_API_KEY "din-nøgle"   (åbn så en ny terminal)',
    ].join('\n');
  }
  if (e instanceof Anthropic.PermissionDeniedError) return `Din konto har ikke adgang til det her endnu: ${e.message}`;
  if (e instanceof Anthropic.BadRequestError) {
    return `Anthropic afviste indstillingerne: ${e.message}\nNævner fejlen en side på listen, så fjern den fra UDVALGTE_SIDER i agent.js og prøv igen.`;
  }
  if (e instanceof Anthropic.RateLimitError) return 'For mange forespørgsler lige nu. Vent lidt, og prøv igen.';
  if (e instanceof Anthropic.APIConnectionError) return 'Kunne ikke få forbindelse til Anthropic. Tjek din internetforbindelse.';
  if (e instanceof Anthropic.APIError) return `Fejl fra Anthropic (${e.status}): ${e.message}`;
  return e && e.stack ? e.stack : String(e);
}

async function main() {
  const gamle = hentIndstillinger();
  const alleSider = await spoergOmNet(gamle.alleSider);
  const client = new Anthropic();
  const nye = { ...gamle, alleSider, budgetCent: gamle.budgetCent || 100 };

  // Miljøet: maskinen, hvor AI'ens værktøjer kører. Skifter du netværk, laver vi et nyt.
  if (!gamle.miljoeId || gamle.alleSider !== alleSider) {
    process.stdout.write('Opretter miljø … ');
    const miljoe = await client.beta.environments.create(miljoeIndstillinger({ alleSider }));
    nye.miljoeId = miljoe.id;
    console.log(miljoe.id);
  } else {
    console.log(`Bruger miljøet ${gamle.miljoeId}`);
  }

  // Agenten: oprettes én gang og opdateres derefter, så den beholder sit id.
  const indstillinger = agentIndstillinger({ alleSider });
  let agent;
  if (gamle.agentId) {
    process.stdout.write(`Opdaterer agenten ${gamle.agentId} … `);
    agent = await client.beta.agents.update(gamle.agentId, indstillinger);
  } else {
    process.stdout.write('Opretter agenten … ');
    agent = await client.beta.agents.create(indstillinger);
  }
  nye.agentId = agent.id;
  nye.agentVersion = agent.version;
  console.log(`${agent.id} (version ${agent.version})`);

  fs.writeFileSync(FIL, JSON.stringify(nye, null, 2) + '\n');
  console.log(`\nFærdig! Indstillingerne er gemt i ${path.relative(process.cwd(), FIL) || FIL}.`);
  console.log(`Hver samtale må højst koste ${(nye.budgetCent / 100).toFixed(2)} dollar. Det kan du ændre i budgetCent.`);
  console.log('Start AI\'en med:  npm start');
}

main().catch((e) => {
  console.error('\n' + forklarFejl(e));
  process.exit(1);
});
