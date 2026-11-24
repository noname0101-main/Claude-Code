'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const { chatStream, tjekNoegle, OpenRouterFejl } = require('../openrouter');
const { koerTur, beskrivVaerktoej } = require('../tur');
const { lavVaerktoejer, ugenummer, datoOgTid } = require('../vaerktoejer');
const { vaerktoejsListe, UDVALGTE_SIDER, STANDARD_MODEL, SYSTEM } = require('../agent');
const { lavServer, hentIndstillinger } = require('../server');

const midlertidigFil = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'opslag-')), 'noter.json');

// ── Hjælpere til en falsk OpenRouter ────────────────────────────────

/** Laver et falsk fetch-svar, der streamer SSE-tekst i små bidder. */
function sseSvar(tekst, { status = 200, bid = 7 } = {}) {
  const bytes = new TextEncoder().encode(tekst);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => JSON.parse(tekst),
    body: (async function* () { for (let i = 0; i < bytes.length; i += bid) yield bytes.slice(i, i + bid); })(),
  };
}

const sse = (...chunks) => chunks.map((c) => (typeof c === 'string' ? c : `data: ${JSON.stringify(c)}`)).join('\n\n') + '\n\n';
const tekstStykke = (content) => ({ choices: [{ index: 0, delta: { content } }] });
const slut = (finish_reason, usage) => ({ choices: [{ index: 0, delta: {}, finish_reason }], ...(usage ? { usage } : {}) });

/** En falsk model, der svarer med de runder, testen har skrevet på forhånd. */
function falskModel(runder) {
  const forespoergsler = [];
  const kaldModel = async function* (forespoergsel) {
    forespoergsler.push(JSON.parse(JSON.stringify(forespoergsel)));
    const runde = runder[forespoergsler.length - 1];
    if (!runde) throw new Error('Modellen blev kaldt for mange gange');
    for (const chunk of runde) yield chunk;
  };
  return { kaldModel, forespoergsler };
}

const INDSTILLINGER = { model: STANDARD_MODEL, budgetDollar: 1, vaerktoejer: vaerktoejsListe({ alleSider: true }) };

// ── OpenRouter-forbindelsen ─────────────────────────────────────────

test('chatStream læser SSE, springer kommentarer over og stopper ved [DONE]', async () => {
  let kaldt = null;
  const fetch = async (url, valg) => {
    kaldt = { url, valg };
    return sseSvar(sse(': OPENROUTER PROCESSING', tekstStykke('Hej '), tekstStykke('med dig'), slut('stop'), 'data: [DONE]', tekstStykke('efter DONE')));
  };
  const stykker = [];
  for await (const c of chatStream({ apiKey: 'nøgle', body: { model: 'm', messages: [] }, fetch })) stykker.push(c);

  assert.equal(kaldt.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(kaldt.valg.headers.Authorization, 'Bearer nøgle');
  assert.equal(JSON.parse(kaldt.valg.body).stream, true);
  assert.deepEqual(stykker.map((c) => c.choices[0].delta.content), ['Hej ', 'med dig', undefined]);
});

test('chatStream giver danske fejlbeskeder ved HTTP-fejl og fejl midt i strømmen', async () => {
  const fejl402 = async () => sseSvar(JSON.stringify({ error: { code: 402, message: 'Insufficient credits' } }), { status: 402 });
  await assert.rejects(async () => { for await (const c of chatStream({ apiKey: 'k', body: {}, fetch: fejl402 })) void c; },
    (e) => e instanceof OpenRouterFejl && e.status === 402 && /credits/.test(e.message));

  const midtI = async () => sseSvar(sse(tekstStykke('Halvt'), { error: { code: 502, message: 'Provider disconnected' }, choices: [{ delta: {}, finish_reason: 'error' }] }));
  await assert.rejects(async () => { for await (const c of chatStream({ apiKey: 'k', body: {}, fetch: midtI })) void c; },
    (e) => e instanceof OpenRouterFejl && e.status === 502 && /svarer ikke/.test(e.message));

  const ingenNet = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(() => tjekNoegle({ apiKey: 'k', fetch: ingenNet }), /internetforbindelse/);
});

// ── Agentens arbejdsgang ─────────────────────────────────────────────

test('en tur: tekst streames, eget værktøj køres, og websøgning og pris vises', async () => {
  const { kaldModel, forespoergsler } = falskModel([
    [
      tekstStykke('Jeg gemmer det.'),
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'gem_note', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"tekst":"Nøglen ligger ' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'under urtepotten"}' } }] } }] },
      slut('tool_calls', { cost: 0.0021 }),
    ],
    [
      tekstStykke('Det er gemt. Rundetårn har '),
      { choices: [{ delta: { content: 'åbent 10-20.', annotations: [{ type: 'url_citation', url_citation: { url: 'https://www.rundetaarn.dk/besoeg/', title: 'Besøg Rundetårn' } }, { type: 'url_citation', url_citation: { url: 'javascript:alert(1)', title: 'x' } }] } }] },
      slut('stop', { cost: 0.0154, server_tool_use_details: { web_search_requests: 2 } }),
    ],
  ]);
  const samtale = { beskeder: [], brugt: 0 };
  const tilBrowser = [];
  const vaerktoejer = lavVaerktoejer({ noteFil: midlertidigFil() });

  await koerTur({ samtale, tekst: 'Husk nøglen, og hvornår har Rundetårn åbent?', kaldModel, indstillinger: INDSTILLINGER, vaerktoejer, send: (h) => tilBrowser.push(h) });

  // Første forespørgsel: system, brugerens besked, model og værktøjer
  const f1 = forespoergsler[0];
  assert.equal(f1.model, STANDARD_MODEL);
  assert.deepEqual(f1.messages.map((m) => m.role), ['system', 'user']);
  assert.equal(f1.messages[0].content, SYSTEM);
  assert.deepEqual(f1.tools.slice(0, 2).map((t) => t.type), ['openrouter:web_search', 'openrouter:web_fetch']);
  assert.ok(f1.max_tool_calls > 0);

  // Anden forespørgsel indeholder værktøjskaldet og resultatet
  const f2 = forespoergsler[1];
  assert.deepEqual(f2.messages.map((m) => m.role), ['system', 'user', 'assistant', 'tool']);
  assert.deepEqual(f2.messages[2].tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'gem_note', arguments: '{"tekst":"Nøglen ligger under urtepotten"}' } }]);
  assert.deepEqual(f2.messages[3], { role: 'tool', tool_call_id: 'call_1', content: 'Gemt som n1: Nøglen ligger under urtepotten' });
  assert.equal(vaerktoejer.noter.find('urtepotten').length, 1);

  // Samtalen husker svaret til næste gang, og prisen er lagt sammen
  assert.deepEqual(samtale.beskeder.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant']);
  assert.equal(samtale.beskeder[3].content, 'Det er gemt. Rundetårn har åbent 10-20.');
  assert.ok(Math.abs(samtale.brugt - 0.0175) < 1e-9);

  const typer = tilBrowser.map((h) => h.type);
  assert.deepEqual(typer.filter((t) => t !== 'tekst'), ['aktivitet', 'aktivitet', 'kilder', 'info']);
  assert.deepEqual(tilBrowser.find((h) => h.type === 'aktivitet'), { type: 'aktivitet', slags: 'note', tekst: 'Husker: Nøglen ligger under urtepotten' });
  assert.equal(tilBrowser.filter((h) => h.type === 'aktivitet')[1].tekst, 'Søgte på nettet 2 gange');
  assert.deepEqual(tilBrowser.find((h) => h.type === 'kilder').kilder, [{ url: 'https://www.rundetaarn.dk/besoeg/', titel: 'Besøg Rundetårn' }]);
  assert.match(tilBrowser.at(-1).tekst, /Pris for svaret: 0,018 dollar · samtalen i alt: 0,018 dollar/);
});

test('ugyldige argumenter og fejl i værktøjer sendes tilbage til modellen', async () => {
  const { kaldModel, forespoergsler } = falskModel([
    [
      { choices: [{ delta: { tool_calls: [
        { index: 0, id: 'a', function: { name: 'slet_note', arguments: '{"id":"n99"}' } },
        { index: 1, id: 'b', function: { name: 'regn', arguments: '{"udtryk": ' } },
      ] } }] },
      slut('tool_calls'),
    ],
    [tekstStykke('Ok.'), slut('stop')],
  ]);
  await koerTur({ samtale: { beskeder: [], brugt: 0 }, tekst: 'x', kaldModel, indstillinger: INDSTILLINGER, vaerktoejer: lavVaerktoejer({ noteFil: midlertidigFil() }), send: () => {} });
  const resultater = forespoergsler[1].messages.filter((m) => m.role === 'tool');
  assert.match(resultater[0].content, /Fejl: Der findes ingen note med id "n99"/);
  assert.match(resultater[1].content, /Fejl: argumenterne var ikke gyldig JSON/);
});

test('budgettet stopper samtalen, før der bruges flere penge', async () => {
  const { kaldModel, forespoergsler } = falskModel([]);
  const tilBrowser = [];
  const samtale = { beskeder: [], brugt: 1.2 };
  await koerTur({ samtale, tekst: 'hej', kaldModel, indstillinger: INDSTILLINGER, vaerktoejer: {}, send: (h) => tilBrowser.push(h) });
  assert.equal(forespoergsler.length, 0);
  assert.match(tilBrowser[0].tekst, /brugt sit budget på 1,000 dollar/);
});

test('går turen galt, bliver samtalen rullet tilbage', async () => {
  const samtale = { beskeder: [{ role: 'user', content: 'før' }, { role: 'assistant', content: 'svar' }], brugt: 0 };
  const kaldModel = async function* () { yield tekstStykke('Halvt'); throw new OpenRouterFejl('Modellen svarer ikke lige nu.', 502); };
  await assert.rejects(() => koerTur({ samtale, tekst: 'nyt', kaldModel, indstillinger: INDSTILLINGER, vaerktoejer: {}, send: () => {} }), /svarer ikke/);
  assert.deepEqual(samtale.beskeder.map((m) => m.content), ['før', 'svar']);
});

test('et afbrudt svar og et tomt svar giver en besked til brugeren', async () => {
  const tilBrowser = [];
  const { kaldModel } = falskModel([[tekstStykke('Langt svar …'), slut('length')], [slut('stop')]]);
  const send = (h) => tilBrowser.push(h);
  await koerTur({ samtale: { beskeder: [], brugt: 0 }, tekst: 'a', kaldModel, indstillinger: INDSTILLINGER, vaerktoejer: {}, send });
  await koerTur({ samtale: { beskeder: [], brugt: 0 }, tekst: 'b', kaldModel, indstillinger: INDSTILLINGER, vaerktoejer: {}, send });
  const advarsler = tilBrowser.filter((h) => h.type === 'advarsel').map((h) => h.tekst);
  assert.match(advarsler[0], /for langt/);
  assert.match(advarsler[1], /svarede ikke/);
});

// ── Værktøjer og indstillinger ──────────────────────────────────────

test('noter kan gemmes, findes og slettes, og regn bruger Hygge', () => {
  const { noter, koer } = lavVaerktoejer({ noteFil: midlertidigFil() });
  koer('gem_note', { tekst: 'Mors fødselsdag er 14. marts', emne: 'fødselsdage' });
  koer('gem_note', { tekst: 'Koden til cykellåsen er 4711' });
  assert.match(koer('find_noter', { ord: 'FØDSELSDAG' }), /n1: Mors fødselsdag er 14\. marts \[emne: fødselsdage\]/);
  assert.equal(koer('find_noter', { ord: 'pas' }), 'Ingen noter fundet.');
  koer('slet_note', { id: 'n1' });
  assert.deepEqual(noter.find('').map((n) => n.id), ['n2']);
  assert.equal(koer('regn', { udtryk: '(350 - 32) * 5 / 9' }), '176.666666667');
  assert.equal(koer('regn', { udtryk: 'afrund(1299 * 0.8 + 49, 2)' }), '1088.2');
  assert.throws(() => koer('regn', { udtryk: 'skriv 1\nsæt x = 2' }), /én linje/);
  assert.throws(() => koer('ukendt', {}), /Ukendt værktøj/);
});

test('dato, ugenummer og beskrivelser', () => {
  assert.equal(ugenummer(new Date(2026, 0, 1)), 1);
  assert.equal(ugenummer(new Date(2026, 11, 31)), 53);
  assert.match(datoOgTid(new Date('2026-11-24T12:00:00Z')), /tirsdag den 24\. november 2026.*13[.:]00.*uge 48/);
  assert.equal(beskrivVaerktoej('regn', { udtryk: '2 + 2' }), 'Regner: 2 + 2');
  assert.ok(beskrivVaerktoej('gem_note', { tekst: 'x'.repeat(500) }).length < 160);
});

test('værktøjslisten følger OpenRouters format, og udvalgte sider begrænser søgningen', () => {
  const alle = vaerktoejsListe({ alleSider: true });
  assert.equal(alle[0].type, 'openrouter:web_search');
  assert.equal(alle[0].parameters.allowed_domains, undefined);
  assert.equal(alle[0].parameters.engine, 'exa');
  assert.equal(alle[1].type, 'openrouter:web_fetch');
  for (const t of alle.slice(2)) {
    assert.equal(t.type, 'function');
    assert.match(t.function.name, /^[a-z_]+$/);
    assert.equal(t.function.parameters.type, 'object');
  }
  assert.deepEqual(alle.slice(2).map((t) => t.function.name), ['dato_og_tid', 'regn', 'gem_note', 'find_noter', 'slet_note']);

  const udvalgte = vaerktoejsListe({ alleSider: false });
  assert.deepEqual(udvalgte[0].parameters.allowed_domains, UDVALGTE_SIDER);
  assert.deepEqual(udvalgte[1].parameters.allowed_domains, UDVALGTE_SIDER);
  assert.equal(new Set(UDVALGTE_SIDER).size, UDVALGTE_SIDER.length, 'ingen dubletter');
  for (const side of UDVALGTE_SIDER) assert.match(side, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
});

test('indstillinger: standardværdier og gemte valg', () => {
  const ingen = hentIndstillinger(path.join(os.tmpdir(), 'findes-ikke-opslag.json'));
  assert.equal(ingen.model, STANDARD_MODEL);
  assert.equal(ingen.alleSider, true);
  assert.equal(ingen.budgetDollar, 1);
  const fil = midlertidigFil();
  fs.writeFileSync(fil, JSON.stringify({ model: 'anthropic/claude-haiku-5.5', alleSider: false, budgetDollar: 0.25 }));
  const gemt = hentIndstillinger(fil);
  assert.deepEqual([gemt.model, gemt.alleSider, gemt.budgetDollar], ['anthropic/claude-haiku-5.5', false, 0.25]);
  assert.ok(gemt.vaerktoejer[0].parameters.allowed_domains);
});

// ── Serveren og chatvinduet ─────────────────────────────────────────

test('serveren laver samtaler, strømmer svar, kan stoppes og afviser forespørgsler uden JSON', async (t) => {
  let ventPaaStop;
  const kaldModel = async function* (forespoergsel, signal) {
    const sidste = forespoergsel.messages.at(-1).content;
    if (sidste === 'vent') {
      yield tekstStykke('Arbejder …');
      await new Promise((resolve, reject) => {
        ventPaaStop = resolve;
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    yield tekstStykke('Hej!');
    yield slut('stop', { cost: 0.001 });
  };
  const server = lavServer({ kaldModel, indstillinger: INDSTILLINGER, vaerktoejer: lavVaerktoejer({ noteFil: midlertidigFil() }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { 'Content-Type': 'application/json' };
  const post = (sti, data, headers = json) => fetch(base + sti, { method: 'POST', headers, body: typeof data === 'string' ? data : JSON.stringify(data) });

  assert.match(await (await fetch(base + '/')).text(), /<title>Opslag<\/title>/);
  assert.equal((await fetch(base + '/ui.js')).status, 200);

  const { id } = await (await post('/api/samtale', {})).json();
  const linjer = (await (await post('/api/besked', { samtale: id, tekst: 'Hej' })).text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(linjer.map((l) => l.type), ['tekst', 'tekst', 'info', 'slut']);
  assert.equal(linjer[1].tekst, 'Hej!');

  // Stop midt i et svar
  const igang = post('/api/besked', { samtale: id, tekst: 'vent' });
  while (!ventPaaStop) await new Promise((r) => setTimeout(r, 5));
  assert.equal((await post('/api/besked', { samtale: id, tekst: 'en til' })).status, 409);
  await post('/api/stop', { samtale: id });
  const stoppet = (await (await igang).text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(stoppet.slice(-2), [{ type: 'advarsel', tekst: 'Stoppet.' }, { type: 'slut' }]);

  assert.equal((await post('/api/besked', { samtale: 'findes-ikke', tekst: 'x' })).status, 404);
  assert.equal((await post('/api/besked', { samtale: id, tekst: '  ' })).status, 400);
  assert.equal((await post('/api/samtale', 'a=1', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
});

test('markdown laver links, lister og tabeller, men aldrig farlig HTML', () => {
  const sandbox = { window: {}, URL };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'ui.js'), 'utf8'), sandbox);
  const md = sandbox.window.Opslag.markdown;

  assert.equal(md('**Fed** og *kursiv*'), '<p><strong>Fed</strong> og <em>kursiv</em></p>');
  assert.equal(md('- en\n- to'), '<ul><li>en</li><li>to</li></ul>');
  assert.equal(md('1. en\n2. to'), '<ol><li>en</li><li>to</li></ol>');
  assert.match(md('[DR](https://www.dr.dk/nyheder?a=1&b=2)'), /<a href="https:\/\/www\.dr\.dk\/nyheder\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">DR<\/a>/);
  assert.match(md('Se https://borger.dk/sundhed.'), /<a href="https:\/\/borger\.dk\/sundhed"[^>]*>borger\.dk\/sundhed<\/a>\.<\/p>/);
  assert.match(md('| Vare | Pris |\n|---|---|\n| Hjelm | 299 kr. |'), /<table><thead><tr><th>Vare<\/th><th>Pris<\/th><\/tr><\/thead><tbody><tr><td>Hjelm<\/td><td>299 kr\.<\/td><\/tr><\/tbody><\/table>/);

  assert.equal(md('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(md('[klik](javascript:alert(1))'), '<p>klik)</p>');
  assert.equal(md('[klik](http://usikker.dk)'), '<p>klik</p>');
  assert.doesNotMatch(md('[x](https://a.dk" onmouseover="alert(1))'), /onmouseover="/);
  assert.equal(md('`<b>kode</b>`'), '<p><code>&lt;b&gt;kode&lt;/b&gt;</code></p>');
});
