'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const { koerTur, beskrivVaerktoej } = require('../tur');
const { lavVaerktoejer, ugenummer, datoOgTid } = require('../vaerktoejer');
const { agentIndstillinger, miljoeIndstillinger, UDVALGTE_SIDER } = require('../agent');
const { lavServer } = require('../server');

const midlertidigFil = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'opslag-')), 'noter.json');

/** En falsk Anthropic-klient, der afspiller en liste hændelser og husker, hvad vi sender. */
function falskKlient(haendelser) {
  const sendt = [];
  return {
    sendt,
    beta: {
      sessions: {
        create: async () => ({ id: 'sesn_test123' }),
        events: {
          stream: async (id, params) => {
            sendt.push({ stream: id, params });
            return (async function* afspil() { for (const h of haendelser) yield h; })();
          },
          send: async (id, body) => { sendt.push(...body.events); return {}; },
        },
      },
    },
  };
}

const ENKEL_TUR = [
  { type: 'session.status_running' },
  { type: 'event_start', event: { type: 'agent.message', id: 'm1' } },
  { type: 'event_delta', event_id: 'm1', delta: { type: 'content_delta', index: 0, content: { type: 'text', text: 'Jeg ' } } },
  { type: 'event_delta', event_id: 'm1', delta: { type: 'content_delta', index: 0, content: { type: 'text', text: 'søger.' } } },
  { type: 'agent.message', id: 'm1', content: [{ type: 'text', text: 'Jeg søger lige.' }] },
  { type: 'span.model_request_end' },
  { type: 'agent.tool_use', id: 'sevt_s', name: 'web_search', input: { query: 'Rundetårn åbningstider' }, evaluated_permission: 'allow' },
  { type: 'agent.custom_tool_use', id: 'sevt_c', name: 'gem_note', input: { tekst: 'Nøglen ligger under urtepotten', emne: 'nøgler' } },
  { type: 'agent.tool_use', id: 'sevt_b', name: 'bash', input: { command: 'echo $((2+2))' }, evaluated_permission: 'ask' },
  { type: 'session.status_idle', stop_reason: { type: 'requires_action', event_ids: ['sevt_c'] } },
  { type: 'agent.message', id: 'm2', content: [{ type: 'text', text: 'Rundetårn har åbent 10-20.\n\nKilder:\n- [Rundetårn](https://www.rundetaarn.dk)' }] },
  { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
  { type: 'agent.message', id: 'efter', content: [{ type: 'text', text: 'Denne må ikke komme med' }] },
];

test('en tur sender beskeden, viser tekst og aktivitet og svarer på værktøjer', async () => {
  const klient = falskKlient(ENKEL_TUR);
  const tilBrowser = [];
  const spurgt = [];
  const vaerktoejer = lavVaerktoejer({ noteFil: midlertidigFil() });

  const resultat = await koerTur({
    client: klient,
    sessionId: 'sesn_test123',
    tekst: 'Hvornår har Rundetårn åbent?',
    send: (h) => tilBrowser.push(h),
    spoerg: async (s) => { spurgt.push(s); return true; },
    vaerktoejer,
  });

  assert.deepEqual(resultat, { afsluttet: false });
  // Strømmen åbnes før beskeden sendes, og med forhåndsvisning af tekst
  assert.deepEqual(klient.sendt[0], { stream: 'sesn_test123', params: { event_deltas: ['agent.message'] } });
  assert.deepEqual(klient.sendt[1], { type: 'user.message', content: [{ type: 'text', text: 'Hvornår har Rundetårn åbent?' }] });

  // Vores eget værktøj blev kørt, og noten blev gemt
  const resultatEvent = klient.sendt.find((e) => e.type === 'user.custom_tool_result');
  assert.equal(resultatEvent.custom_tool_use_id, 'sevt_c');
  assert.equal(resultatEvent.is_error, false);
  assert.match(resultatEvent.content[0].text, /Gemt som n1/);
  assert.equal(vaerktoejer.noter.find('urtepotten').length, 1);

  // bash bad om lov, og vi sagde ja
  assert.deepEqual(spurgt, [{ id: 'sevt_b', beskrivelse: 'Regner: echo $((2+2))' }]);
  assert.deepEqual(klient.sendt.find((e) => e.type === 'user.tool_confirmation'), { type: 'user.tool_confirmation', tool_use_id: 'sevt_b', result: 'allow' });

  // Browseren fik teksten, mens den blev skrevet, og den færdige tekst bagefter
  const tekster = tilBrowser.filter((h) => h.type === 'tekst');
  assert.deepEqual(tekster.slice(0, 3).map((h) => h.tekst), ['Jeg ', 'Jeg søger.', 'Jeg søger lige.']);
  assert.equal(tekster[2].faerdig, true);
  assert.match(tekster.at(-1).tekst, /Kilder:/);
  assert.ok(!tilBrowser.some((h) => h.tekst === 'Denne må ikke komme med'), 'turen skal stoppe ved end_turn');

  const aktiviteter = tilBrowser.filter((h) => h.type === 'aktivitet');
  assert.deepEqual(aktiviteter.map((h) => [h.slags, h.tekst]), [
    ['soeg', 'Søger efter "Rundetårn åbningstider"'],
    ['note', 'Husker: Nøglen ligger under urtepotten'],
    ['regn', 'Regner: echo $((2+2))'],
  ]);
});

test('et nej til et værktøj sendes som deny med en forklaring', async () => {
  const klient = falskKlient([
    { type: 'agent.tool_use', id: 'sevt_x', name: 'web_fetch', input: { url: 'https://example.com' }, evaluated_permission: 'ask' },
    { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
  ]);
  await koerTur({ client: klient, sessionId: 's', tekst: 'hej', send: () => {}, spoerg: async () => false, vaerktoejer: lavVaerktoejer({ noteFil: midlertidigFil() }) });
  const svar = klient.sendt.find((e) => e.type === 'user.tool_confirmation');
  assert.equal(svar.result, 'deny');
  assert.ok(svar.deny_message);
});

test('budget, afbrudte svar og lukkede samtaler giver en besked til brugeren', async () => {
  const tilBrowser = [];
  const klient = falskKlient([
    { type: 'event_start', event: { type: 'agent.message', id: 'm9' } },
    { type: 'event_delta', event_id: 'm9', delta: { type: 'content_delta', index: 0, content: { type: 'text', text: 'Halvt svar' } } },
    { type: 'span.model_request_end' },
    { type: 'session.status_idle', stop_reason: { type: 'budget_reached' } },
  ]);
  await koerTur({ client: klient, sessionId: 's', tekst: 'hej', send: (h) => tilBrowser.push(h), spoerg: async () => false, vaerktoejer: {} });
  assert.deepEqual(tilBrowser.find((h) => h.type === 'tekst' && h.faerdig), { type: 'tekst', id: 'm9', tekst: 'Halvt svar', faerdig: true });
  assert.match(tilBrowser.find((h) => h.type === 'advarsel').tekst, /budget/);

  const lukket = falskKlient([{ type: 'session.status_terminated' }]);
  const r = await koerTur({ client: lukket, sessionId: 's', tekst: 'hej', send: () => {}, spoerg: async () => false, vaerktoejer: {} });
  assert.deepEqual(r, { afsluttet: true });
});

test('en fejl i et værktøj sendes tilbage som is_error', async () => {
  const klient = falskKlient([
    { type: 'agent.custom_tool_use', id: 'sevt_d', name: 'slet_note', input: { id: 'n99' } },
    { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
  ]);
  await koerTur({ client: klient, sessionId: 's', tekst: 'glem n99', send: () => {}, spoerg: async () => false, vaerktoejer: lavVaerktoejer({ noteFil: midlertidigFil() }) });
  const svar = klient.sendt.find((e) => e.type === 'user.custom_tool_result');
  assert.equal(svar.is_error, true);
  assert.match(svar.content[0].text, /Der findes ingen note med id "n99"/);
});

test('noter kan gemmes, findes og slettes', () => {
  const { noter, koer } = lavVaerktoejer({ noteFil: midlertidigFil() });
  koer('gem_note', { tekst: 'Mors fødselsdag er 14. marts', emne: 'fødselsdage' });
  koer('gem_note', { tekst: 'Koden til cykellåsen er 4711' });
  assert.match(koer('find_noter', { ord: 'FØDSELSDAG' }), /n1: Mors fødselsdag er 14\. marts \[emne: fødselsdage\]/);
  assert.match(koer('find_noter', { ord: '' }), /n2: Koden til cykellåsen/);
  assert.equal(koer('find_noter', { ord: 'pas' }), 'Ingen noter fundet.');
  koer('slet_note', { id: 'n1' });
  assert.deepEqual(noter.find('').map((n) => n.id), ['n2']);
  assert.throws(() => koer('gem_note', { tekst: '  ' }), /tom/);
  assert.throws(() => koer('ukendt', {}), /Ukendt værktøj/);
});

test('dato og ugenummer', () => {
  assert.equal(ugenummer(new Date(2026, 0, 1)), 1);
  assert.equal(ugenummer(new Date(2026, 11, 31)), 53);
  assert.equal(ugenummer(new Date(2027, 0, 4)), 1);
  assert.match(datoOgTid(new Date('2026-11-24T12:00:00Z')), /tirsdag den 24\. november 2026.*13[.:]00.*uge 48/);
});

test('beskrivelser af værktøjer er korte og læsbare', () => {
  assert.equal(beskrivVaerktoej('web_fetch', { url: 'https://dr.dk' }), 'Læser https://dr.dk');
  assert.equal(beskrivVaerktoej('find_noter', { ord: '' }), 'Kigger i dine noter');
  assert.ok(beskrivVaerktoej('web_search', { query: 'x'.repeat(500) }).length < 160);
});

test('agentens indstillinger: websøgning er slået til, og udvalgte sider begrænser den', () => {
  const alle = agentIndstillinger({ alleSider: true });
  assert.equal(alle.model.id, 'claude-opus-5-5');
  const toolset = alle.tools[0];
  assert.equal(toolset.type, 'agent_toolset_20260401');
  assert.deepEqual(toolset.configs.map((c) => [c.name, c.enabled]), [['web_search', true], ['web_fetch', true], ['bash', true]]);
  assert.equal(toolset.configs[0].allowed_domains, undefined);
  assert.deepEqual(alle.tools.slice(1).map((t) => t.name), ['dato_og_tid', 'gem_note', 'find_noter', 'slet_note']);
  for (const t of alle.tools.slice(1)) assert.match(t.name, /^[a-z_]+$/);

  const udvalgte = agentIndstillinger({ alleSider: false });
  assert.deepEqual(udvalgte.tools[0].configs[0].allowed_domains, UDVALGTE_SIDER);
  assert.ok(UDVALGTE_SIDER.length <= 64, 'højst 64 sider pr. liste');
  assert.equal(new Set(UDVALGTE_SIDER).size, UDVALGTE_SIDER.length, 'ingen dubletter');
  for (const side of UDVALGTE_SIDER) assert.match(side, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/);

  assert.deepEqual(miljoeIndstillinger({ alleSider: true }).config.networking, { type: 'unrestricted' });
  const begraenset = miljoeIndstillinger({ alleSider: false }).config.networking;
  assert.equal(begraenset.type, 'limited');
  assert.ok(begraenset.allowed_hosts.includes('*.wikipedia.org') && begraenset.allowed_hosts.includes('wikipedia.org'));
});

test('serveren laver samtaler, strømmer svar og afviser forespørgsler uden JSON', async (t) => {
  const klient = falskKlient([
    { type: 'agent.message', id: 'm1', content: [{ type: 'text', text: 'Hej!' }] },
    { type: 'session.status_idle', stop_reason: { type: 'end_turn' } },
  ]);
  const server = lavServer({
    client: klient,
    indstillinger: { agentId: 'agent_x', miljoeId: 'env_x', budgetCent: 50 },
    vaerktoejer: lavVaerktoejer({ noteFil: midlertidigFil() }),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { 'Content-Type': 'application/json' };

  const side = await fetch(base + '/');
  assert.match(await side.text(), /<title>Opslag<\/title>/);
  assert.equal((await fetch(base + '/ui.js')).status, 200);

  const ny = await (await fetch(base + '/api/samtale', { method: 'POST', headers: json, body: '{}' })).json();
  assert.equal(ny.id, 'sesn_test123');

  const svar = await fetch(base + '/api/besked', { method: 'POST', headers: json, body: JSON.stringify({ samtale: ny.id, tekst: 'Hej' }) });
  const linjer = (await svar.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(linjer, [{ type: 'tekst', id: 'm1', tekst: 'Hej!', faerdig: true }, { type: 'slut', afsluttet: false }]);

  const formular = await fetch(base + '/api/samtale', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(formular.status, 415);
  const tom = await fetch(base + '/api/besked', { method: 'POST', headers: json, body: JSON.stringify({ samtale: ny.id, tekst: '  ' }) });
  assert.equal(tom.status, 400);
  assert.equal((await fetch(base + '/findes-ikke')).status, 404);
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

  // Farlige ting bliver til almindelig tekst
  assert.equal(md('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(md('[klik](javascript:alert(1))'), '<p>klik)</p>');
  assert.equal(md('[klik](http://usikker.dk)'), '<p>klik</p>');
  assert.doesNotMatch(md('[x](https://a.dk" onmouseover="alert(1))'), /onmouseover="/);
  assert.equal(md('`<b>kode</b>`'), '<p><code>&lt;b&gt;kode&lt;/b&gt;</code></p>');
});
