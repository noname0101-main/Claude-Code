#!/usr/bin/env node
'use strict';

/*
 * Opslag-serveren. Start den med `npm start`, og åbn http://localhost:3000.
 *
 * Serveren holder din API-nøgle hos sig selv. Browseren taler kun med serveren,
 * og serveren taler med Anthropic.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { koerTur } = require('./tur');
const { lavVaerktoejer } = require('./vaerktoejer');

const PORT = Number(process.env.PORT) || 3000;
const VAERT = process.env.HOST || '127.0.0.1'; // kun din egen computer kan se siden
const INDSTILLINGER = path.join(__dirname, 'indstillinger.json');
const OFFENTLIG = path.join(__dirname, 'public');
const VENT_PAA_SVAR_MS = 5 * 60 * 1000;

function hentIndstillinger() {
  try {
    const data = JSON.parse(fs.readFileSync(INDSTILLINGER, 'utf8'));
    if (data.agentId && data.miljoeId) return data;
  } catch (e) { /* findes ikke endnu */ }
  console.error('Opslag er ikke sat op endnu. Kør først:  npm run opsaet');
  process.exit(1);
}

/** Svar til browseren, når noget går galt med Anthropic. */
function fejltekst(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API-nøglen virker ikke. Tjek ANTHROPIC_API_KEY, og genstart serveren.';
  if (e instanceof Anthropic.NotFoundError) return 'Samtalen eller agenten findes ikke længere. Start en ny samtale, eller kør npm run opsaet igen.';
  if (e instanceof Anthropic.RateLimitError) return 'For mange forespørgsler lige nu. Vent lidt, og prøv igen.';
  if (e instanceof Anthropic.BadRequestError) return `Anthropic afviste forespørgslen: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Kunne ikke få forbindelse til Anthropic. Tjek din internetforbindelse.';
  if (e instanceof Anthropic.APIError) return `Fejl fra Anthropic (${e.status}): ${e.message}`;
  return `Der skete en fejl: ${e && e.message ? e.message : e}`;
}

function laesJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (bid) => {
      data += bid;
      if (data.length > 100000) {
        reject(new Error('For stor forespørgsel'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Ugyldig JSON')); }
    });
    req.on('error', reject);
  });
}

function svarJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function lavServer({ client, indstillinger, vaerktoejer }) {
  /** Samtaler, der kører lige nu: sessionId → { optaget, ventende: Map<id, resolve> } */
  const samtaler = new Map();
  const samtale = (id) => {
    if (!samtaler.has(id)) samtaler.set(id, { optaget: false, ventende: new Map() });
    return samtaler.get(id);
  };

  async function nySamtale(req, res) {
    const session = await client.beta.sessions.create({
      agent: indstillinger.agentId,
      environment_id: indstillinger.miljoeId,
      title: `Opslag ${new Date().toLocaleString('da-DK')}`,
      budget: { type: 'limit', max_list_cost: { amount: String(indstillinger.budgetCent || 100), currency: 'USD' } },
    });
    console.log(`Ny samtale: ${session.id}`);
    console.log(`  Se den i Console: https://platform.claude.com/workspaces/default/sessions/${session.id}`);
    svarJson(res, 200, { id: session.id });
  }

  async function besked(req, res) {
    const { samtale: sessionId, tekst } = await laesJson(req);
    if (typeof sessionId !== 'string' || !/^[\w-]{4,200}$/.test(sessionId)) return svarJson(res, 400, { fejl: 'Mangler samtale' });
    if (typeof tekst !== 'string' || !tekst.trim()) return svarJson(res, 400, { fejl: 'Beskeden er tom' });
    const s = samtale(sessionId);
    if (s.optaget) return svarJson(res, 409, { fejl: 'AI\'en arbejder stadig på det forrige spørgsmål.' });
    s.optaget = true;

    // Svaret er en strøm af JSON-linjer, som browseren læser, mens de kommer
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    let aaben = true;
    res.on('close', () => {
      aaben = false;
      // Lukker browseren, siger vi nej til det, der venter på et svar
      for (const resolve of s.ventende.values()) resolve(false);
    });
    const send = (data) => { if (aaben) res.write(JSON.stringify(data) + '\n'); };

    const spoerg = ({ id, beskrivelse }) => new Promise((resolve) => {
      if (!aaben) return resolve(false);
      const timer = setTimeout(() => { s.ventende.delete(id); resolve(false); }, VENT_PAA_SVAR_MS);
      s.ventende.set(id, (svar) => { clearTimeout(timer); s.ventende.delete(id); resolve(svar); });
      send({ type: 'spoerg', id, tekst: beskrivelse });
    });

    try {
      const { afsluttet } = await koerTur({ client, sessionId, tekst: tekst.trim(), send, spoerg, vaerktoejer });
      send({ type: 'slut', afsluttet });
    } catch (e) {
      console.error(e);
      send({ type: 'advarsel', tekst: fejltekst(e) });
      send({ type: 'slut', afsluttet: e instanceof Anthropic.NotFoundError });
    } finally {
      s.optaget = false;
      if (aaben) res.end();
    }
    return undefined;
  }

  async function godkend(req, res) {
    const { samtale: sessionId, id, svar } = await laesJson(req);
    const s = samtaler.get(sessionId);
    const resolve = s && s.ventende.get(id);
    if (!resolve) return svarJson(res, 404, { fejl: 'Der venter ikke noget spørgsmål med det id.' });
    resolve(svar === 'tillad');
    return svarJson(res, 200, { ok: true });
  }

  async function stop(req, res) {
    const { samtale: sessionId } = await laesJson(req);
    await client.beta.sessions.events.send(sessionId, { events: [{ type: 'user.interrupt' }] });
    svarJson(res, 200, { ok: true });
  }

  function noter(req, res) {
    svarJson(res, 200, { noter: vaerktoejer.noter.find('') });
  }

  const fil = (navn, type) => (req, res) => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(path.join(OFFENTLIG, navn)).pipe(res);
  };

  const ruter = {
    'GET /': fil('index.html', 'text/html; charset=utf-8'),
    'GET /ui.js': fil('ui.js', 'text/javascript; charset=utf-8'),
    'GET /stil.css': fil('stil.css', 'text/css; charset=utf-8'),
    'POST /api/samtale': nySamtale,
    'POST /api/besked': besked,
    'POST /api/godkend': godkend,
    'POST /api/stop': stop,
    'GET /api/noter': noter,
  };

  return http.createServer(async (req, res) => {
    const rute = ruter[`${req.method} ${req.url.split('?')[0]}`];
    if (!rute) return svarJson(res, 404, { fejl: 'Ikke fundet' });
    // Kun forespørgsler fra vores egen side må styre AI'en
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      return svarJson(res, 415, { fejl: 'Forventede JSON' });
    }
    try {
      await rute(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) svarJson(res, 500, { fejl: fejltekst(e) });
      else res.end();
    }
    return undefined;
  });
}

if (require.main === module) {
  const indstillinger = hentIndstillinger();
  const server = lavServer({
    client: new Anthropic(),
    indstillinger,
    vaerktoejer: lavVaerktoejer({ noteFil: path.join(__dirname, 'noter.json') }),
  });
  server.listen(PORT, VAERT, () => {
    console.log(`Opslag kører på http://localhost:${PORT}`);
    console.log(`Hver samtale må højst koste ${((indstillinger.budgetCent || 100) / 100).toFixed(2)} dollar.`);
  });
}

module.exports = { lavServer, fejltekst };
