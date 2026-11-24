#!/usr/bin/env node
'use strict';

/*
 * Opslag-serveren. Start den med `npm start`, og åbn http://localhost:3000.
 *
 * Serveren holder din OpenRouter-nøgle hos sig selv. Browseren taler kun med
 * serveren, og serveren taler med OpenRouter.
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chatStream } = require('./openrouter');
const { koerTur } = require('./tur');
const { lavVaerktoejer } = require('./vaerktoejer');
const { STANDARD_MODEL, vaerktoejsListe } = require('./agent');

const PORT = Number(process.env.PORT) || 3000;
const VAERT = process.env.HOST || '127.0.0.1'; // kun din egen computer kan se siden
const INDSTILLINGER = path.join(__dirname, 'indstillinger.json');
const OFFENTLIG = path.join(__dirname, 'public');
const MAKS_SAMTALER = 50;

/** Indstillinger fra `npm run opsaet`, eller standardværdier. */
function hentIndstillinger(fil = INDSTILLINGER) {
  let gemte = {};
  try { gemte = JSON.parse(fs.readFileSync(fil, 'utf8')); } catch (e) { /* ikke sat op – brug standard */ }
  const alleSider = gemte.alleSider !== false;
  return {
    model: typeof gemte.model === 'string' && gemte.model ? gemte.model : STANDARD_MODEL,
    alleSider,
    budgetDollar: Number(gemte.budgetDollar) > 0 ? Number(gemte.budgetDollar) : 1,
    vaerktoejer: vaerktoejsListe({ alleSider }),
  };
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

/**
 * @param {object} p
 * @param {(forespoergsel: object, signal?: AbortSignal) => AsyncIterable<object>} p.kaldModel
 * @param {ReturnType<typeof hentIndstillinger>} p.indstillinger
 * @param {ReturnType<typeof lavVaerktoejer>} p.vaerktoejer
 */
function lavServer({ kaldModel, indstillinger, vaerktoejer }) {
  /** Samtaler, mens serveren kører: id → { beskeder, brugt, styring } */
  const samtaler = new Map();

  function nySamtale(req, res) {
    const id = crypto.randomUUID();
    samtaler.set(id, { beskeder: [], brugt: 0, styring: null });
    // Gem ikke uendeligt mange gamle samtaler
    while (samtaler.size > MAKS_SAMTALER) samtaler.delete(samtaler.keys().next().value);
    svarJson(res, 200, { id });
  }

  async function besked(req, res) {
    const { samtale: id, tekst } = await laesJson(req);
    const samtale = samtaler.get(id);
    if (!samtale) return svarJson(res, 404, { fejl: 'Samtalen findes ikke længere. Start en ny samtale.' });
    if (typeof tekst !== 'string' || !tekst.trim()) return svarJson(res, 400, { fejl: 'Beskeden er tom' });
    if (samtale.styring) return svarJson(res, 409, { fejl: 'AI\'en arbejder stadig på det forrige spørgsmål.' });
    samtale.styring = new AbortController();

    // Svaret er en strøm af JSON-linjer, som browseren læser, mens de kommer
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    let aaben = true;
    res.on('close', () => { aaben = false; });
    const send = (data) => { if (aaben) res.write(JSON.stringify(data) + '\n'); };

    try {
      await koerTur({
        samtale,
        tekst: tekst.trim(),
        kaldModel,
        indstillinger,
        vaerktoejer,
        send,
        signal: samtale.styring.signal,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') send({ type: 'advarsel', tekst: 'Stoppet.' });
      else {
        if (!e || e.name !== 'OpenRouterFejl') console.error(e);
        send({ type: 'advarsel', tekst: e && e.message ? e.message : 'Der skete en fejl.' });
      }
    } finally {
      samtale.styring = null;
      send({ type: 'slut' });
      if (aaben) res.end();
    }
    return undefined;
  }

  async function stop(req, res) {
    const { samtale: id } = await laesJson(req);
    const samtale = samtaler.get(id);
    if (samtale && samtale.styring) samtale.styring.abort();
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
    'POST /api/stop': stop,
    'GET /api/noter': noter,
  };

  return http.createServer(async (req, res) => {
    const rute = ruter[`${req.method} ${req.url.split('?')[0]}`];
    if (!rute) return svarJson(res, 404, { fejl: 'Ikke fundet' });
    // Kun forespørgsler fra vores egen side må styre AI'en (andre sider kan ikke sende JSON hertil)
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').startsWith('application/json')) {
      return svarJson(res, 415, { fejl: 'Forventede JSON' });
    }
    try {
      await rute(req, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) svarJson(res, 500, { fejl: e.message });
      else res.end();
    }
    return undefined;
  });
}

if (require.main === module) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Mangler OPENROUTER_API_KEY.');
    console.error('Lav en nøgle på https://openrouter.ai/settings/keys og sæt den, før du starter:');
    console.error('  macOS/Linux:  export OPENROUTER_API_KEY="din-nøgle"');
    console.error('  Windows:      setx OPENROUTER_API_KEY "din-nøgle"   (åbn så en ny terminal)');
    process.exit(1);
  }
  const indstillinger = hentIndstillinger();
  const server = lavServer({
    kaldModel: (body, signal) => chatStream({ apiKey, body, signal }),
    indstillinger,
    vaerktoejer: lavVaerktoejer({ noteFil: path.join(__dirname, 'noter.json') }),
  });
  server.listen(PORT, VAERT, () => {
    console.log(`Opslag kører på http://localhost:${PORT}`);
    console.log(`Model: ${indstillinger.model} · ${indstillinger.alleSider ? 'søger på hele nettet' : 'kun udvalgte sider'}`);
    console.log(`Hver samtale må højst koste ${indstillinger.budgetDollar.toLocaleString('da-DK')} dollar.`);
  });
}

module.exports = { lavServer, hentIndstillinger };
