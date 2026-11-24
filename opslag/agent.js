'use strict';

/*
 * Hvordan AI'en "Opslag" er sat op: model, instruktioner og værktøjer.
 * opsaet.js sender dette til Anthropic, når agenten oprettes eller opdateres.
 * Ændrer du noget her, så kør `npm run opsaet` igen.
 */

const NAVN = 'Opslag';

// Kilder, som AI'en må bruge, hvis du vælger "kun udvalgte sider" under opsætningen.
// En side dækker også sine underdomæner (wikipedia.org dækker da.wikipedia.org).
const UDVALGTE_SIDER = [
  // Opslagsværker og sprog
  'wikipedia.org', 'wiktionary.org', 'lex.dk', 'ordnet.dk', 'dsn.dk', 'sproget.dk', 'britannica.com',
  // Nyheder
  'dr.dk', 'tv2.dk', 'ritzau.dk',
  // Det offentlige, sundhed og jura
  'borger.dk', 'sundhed.dk', 'sst.dk', 'skat.dk', 'politi.dk', 'retsinformation.dk', 'ft.dk', 'dst.dk',
  'kk.dk', 'aarhus.dk', 'virk.dk', 'uvm.dk', 'su.dk',
  // Vejr, transport og rejser
  'dmi.dk', 'yr.no', 'rejseplanen.dk', 'dsb.dk', 'visitdenmark.dk', 'kort.dk',
  // Butikker, priser og firmaer
  'pricerunner.dk', 'prisjagt.dk', 'krak.dk', 'proff.dk', 'trustpilot.com', 'forbrugerraadet.dk', 'taenk.dk',
  // Kultur, viden og fritid
  'bibliotek.dk', 'natmus.dk', 'smk.dk', 'kino.dk', 'billetto.dk', 'ticketmaster.dk', 'nasa.gov', 'who.int',
  'nationalgeographic.com', 'videnskab.dk', 'imdb.com',
];

const SYSTEM = `Du er ${NAVN}, en hjælpsom assistent, der finder ting og slår ting op for folk.

Sådan arbejder du:
- Svar på dansk, medmindre personen skriver på et andet sprog.
- Når spørgsmålet handler om noget, der kan ændre sig (priser, åbningstider, nyheder, vejr, begivenheder, varer, regler), eller når du ikke er helt sikker, så søg på nettet med web_search. Læs siden med web_fetch, når søgeresultaterne ikke er nok.
- Foretræk pålidelige kilder: officielle sider, myndigheder som borger.dk og sundhed.dk, store medier og opslagsværker.
- Slut altid med en kort liste kaldet "Kilder:" med links i formen [titel](https://...) til de sider, du faktisk brugte. Find aldrig selv på links.
- Kan du ikke finde noget, eller er kilderne uenige, så sig det ærligt.
- Hold svarene korte og praktiske. Brug punktlister, når du sammenligner ting.
- Brug dato_og_tid, når svaret afhænger af dags dato eller klokken. Gæt ikke.
- Brug bash til udregninger og omregninger, der skal være helt præcise.
- Når personen beder dig huske noget, så brug gem_note. Når de spørger efter noget, de har bedt dig huske, så brug find_noter. Brug slet_note, når de beder dig glemme noget.
- Ved spørgsmål om helbred, jura eller penge giver du almindelig information og anbefaler at spørge en fagperson, når det er vigtigt.`;

/** Værktøjer, som vores egen server udfører (se vaerktoejer.js). */
const EGNE_VAERKTOEJER = [
  {
    type: 'custom',
    name: 'dato_og_tid',
    description: 'Giver dags dato, ugedag, ugenummer og klokken i Danmark lige nu.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    type: 'custom',
    name: 'gem_note',
    description: 'Gemmer en note, som personen har bedt dig huske, fx hvor de har lagt noget, en kode til skabet eller en idé. Noten bliver gemt på personens egen computer.',
    input_schema: {
      type: 'object',
      properties: {
        tekst: { type: 'string', description: 'Det, der skal huskes, skrevet som en hel sætning.' },
        emne: { type: 'string', description: 'Et kort emne, fx "nøgler" eller "fødselsdage".' },
      },
      required: ['tekst'],
    },
  },
  {
    type: 'custom',
    name: 'find_noter',
    description: 'Søger i de noter, personen tidligere har bedt dig huske. Giv et tomt søgeord for at se alle noter.',
    input_schema: {
      type: 'object',
      properties: {
        ord: { type: 'string', description: 'Søgeord, fx "pas" eller "mor". Tomt giver alle noter.' },
      },
      required: ['ord'],
    },
  },
  {
    type: 'custom',
    name: 'slet_note',
    description: 'Sletter en note ud fra dens id. Find id\'et med find_noter først.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Notens id, fx "n3".' } },
      required: ['id'],
    },
  },
];

/**
 * Bygger agentens indstillinger.
 * @param {{ alleSider: boolean }} valg  alleSider=false begrænser websøgning til UDVALGTE_SIDER
 */
function agentIndstillinger({ alleSider }) {
  const begraensning = alleSider ? {} : { allowed_domains: UDVALGTE_SIDER };
  return {
    name: NAVN,
    description: 'Finder ting og slår ting op for folk. Søger på nettet og viser sine kilder.',
    model: { id: 'claude-opus-5-5', effort: 'medium' },
    system: SYSTEM,
    tools: [
      {
        type: 'agent_toolset_20260401',
        // Kun de værktøjer, AI'en har brug for. Serveren vurderer hvert kald (auto).
        default_config: { enabled: false, permission_policy: { type: 'auto' } },
        configs: [
          {
            name: 'web_search',
            enabled: true,
            user_location: { type: 'approximate', country: 'DK', timezone: 'Europe/Copenhagen' },
            ...begraensning,
          },
          { name: 'web_fetch', enabled: true, max_content_tokens: 30000, ...begraensning },
          { name: 'bash', enabled: true },
        ],
      },
      ...EGNE_VAERKTOEJER,
    ],
  };
}

/** Netværket til den maskine, hvor AI'ens værktøjer kører. */
function miljoeIndstillinger({ alleSider }) {
  const networking = alleSider
    ? { type: 'unrestricted' }
    : {
      type: 'limited',
      // allowed_hosts matcher præcise værtsnavne, så vi tilføjer også *.underdomæner
      allowed_hosts: UDVALGTE_SIDER.flatMap((side) => [side, `*.${side}`]),
    };
  return {
    name: alleSider ? 'opslag-alle-sider' : 'opslag-udvalgte-sider',
    config: { type: 'cloud', networking },
  };
}

module.exports = { NAVN, SYSTEM, UDVALGTE_SIDER, EGNE_VAERKTOEJER, agentIndstillinger, miljoeIndstillinger };
