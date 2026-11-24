'use strict';

/*
 * Hvordan AI'en "Opslag" er sat op: instruktioner og værktøjer.
 *
 * Websøgning og læsning af sider er "server tools", som OpenRouter selv kører,
 * når modellen beder om det. De andre værktøjer kører vores egen server
 * (se vaerktoejer.js).
 */

const NAVN = 'Opslag';

/** Modellen, der bruges, hvis du ikke vælger en anden med `npm run opsaet`. */
const STANDARD_MODEL = 'anthropic/claude-opus-5.5';

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
- Når spørgsmålet handler om noget, der kan ændre sig (priser, åbningstider, nyheder, vejr, begivenheder, varer, regler), eller når du ikke er helt sikker, så søg på nettet. Læs selve siden, når søgeresultaterne ikke er nok.
- Foretræk pålidelige kilder: officielle sider, myndigheder som borger.dk og sundhed.dk, store medier og opslagsværker.
- Slut altid med en kort liste kaldet "Kilder:" med links i formen [titel](https://...) til de sider, du faktisk brugte. Find aldrig selv på links.
- Kan du ikke finde noget, eller er kilderne uenige, så sig det ærligt.
- Hold svarene korte og praktiske. Brug punktlister, når du sammenligner ting.
- Brug dato_og_tid, når svaret afhænger af dags dato eller klokken. Gæt ikke.
- Brug regn til udregninger og omregninger, der skal være helt præcise.
- Når personen beder dig huske noget, så brug gem_note. Når de spørger efter noget, de har bedt dig huske, så brug find_noter. Brug slet_note, når de beder dig glemme noget.
- Ved spørgsmål om helbred, jura eller penge giver du almindelig information og anbefaler at spørge en fagperson, når det er vigtigt.`;

const funktion = (name, description, parameters = { type: 'object', properties: {} }) => ({
  type: 'function',
  function: { name, description, parameters },
});

/** Værktøjer, som vores egen server udfører (se vaerktoejer.js). */
const EGNE_VAERKTOEJER = [
  funktion('dato_og_tid', 'Giver dags dato, ugedag, ugenummer og klokken i Danmark lige nu.'),
  funktion('regn', 'Regner et udtryk præcist ud. Brug + - * / % (rest) og ^ (potens), parenteser og funktionerne kvadratrod(x), afrund(x, decimaler) og absolut(x). Decimaltal skrives med punktum.', {
    type: 'object',
    properties: { udtryk: { type: 'string', description: 'Fx "(1299 * 0.8) + 49" eller "(350 - 32) * 5 / 9"' } },
    required: ['udtryk'],
  }),
  funktion('gem_note', 'Gemmer en note, som personen har bedt dig huske, fx hvor de har lagt noget eller en fødselsdag. Noten bliver gemt på personens egen computer.', {
    type: 'object',
    properties: {
      tekst: { type: 'string', description: 'Det, der skal huskes, skrevet som en hel sætning.' },
      emne: { type: 'string', description: 'Et kort emne, fx "nøgler" eller "fødselsdage".' },
    },
    required: ['tekst'],
  }),
  funktion('find_noter', 'Søger i de noter, personen tidligere har bedt dig huske. Giv et tomt søgeord for at se alle noter.', {
    type: 'object',
    properties: { ord: { type: 'string', description: 'Søgeord, fx "pas" eller "mor". Tomt giver alle noter.' } },
    required: ['ord'],
  }),
  funktion('slet_note', 'Sletter en note ud fra dens id. Find id\'et med find_noter først.', {
    type: 'object',
    properties: { id: { type: 'string', description: 'Notens id, fx "n3".' } },
    required: ['id'],
  }),
];

/**
 * Alle værktøjer, modellen får. Skal sendes med i hver forespørgsel.
 * @param {{ alleSider: boolean }} valg  alleSider=false begrænser websøgning til UDVALGTE_SIDER
 */
function vaerktoejsListe({ alleSider }) {
  const begraensning = alleSider ? {} : { allowed_domains: UDVALGTE_SIDER };
  return [
    {
      type: 'openrouter:web_search',
      parameters: {
        // Exa sender korte uddrag af hver side. Modellens egen søgning (engine: 'native')
        // sender ofte hele sider med, hvilket gjorde et svar op til 10 gange dyrere i vores test.
        engine: 'exa',
        max_results: 5,
        max_uses: 4,
        ...begraensning,
      },
    },
    {
      type: 'openrouter:web_fetch',
      parameters: { max_uses: 3, max_content_tokens: 10000, ...begraensning },
    },
    ...EGNE_VAERKTOEJER,
  ];
}

module.exports = { NAVN, SYSTEM, STANDARD_MODEL, UDVALGTE_SIDER, EGNE_VAERKTOEJER, vaerktoejsListe };
