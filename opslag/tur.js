'use strict';

/*
 * Én "tur" i samtalen: brugeren skriver noget, og AI'en arbejder, indtil den har svaret.
 *
 * Det sker i runder. I hver runde sender vi hele samtalen til modellen:
 *   - Svarer den med tekst, er vi færdige.
 *   - Beder den om at bruge et af vores egne værktøjer, kører vi det, lægger
 *     resultatet ind i samtalen og starter en ny runde.
 * Websøgning og læsning af sider klarer OpenRouter selv inde i en runde.
 */

const { SYSTEM } = require('./agent');

const MAKS_RUNDER = 8;      // højst så mange kald til modellen pr. spørgsmål
const MAKS_SERVERKALD = 8;  // højst så mange websøgninger og sidelæsninger pr. runde
const MAKS_TOKENS = 8000;   // loft over svarets længde; OpenRouter reserverer penge ud fra det
const MAKS_VIST = 140;

function kort(tekst) {
  const t = String(tekst ?? '').replace(/\s+/g, ' ').trim();
  return t.length > MAKS_VIST ? t.slice(0, MAKS_VIST - 1) + '…' : t;
}

/** En læsbar beskrivelse af, hvad AI'en er i gang med. */
function beskrivVaerktoej(navn, input = {}) {
  switch (navn) {
    case 'dato_og_tid': return 'Tjekker dato og klokkeslæt';
    case 'regn': return `Regner: ${kort(input.udtryk)}`;
    case 'gem_note': return `Husker: ${kort(input.tekst)}`;
    case 'find_noter': return input.ord ? `Leder i dine noter efter "${kort(input.ord)}"` : 'Kigger i dine noter';
    case 'slet_note': return `Sletter note ${kort(input.id)}`;
    default: return `Bruger ${navn}`;
  }
}

/** Hvilket ikon browseren skal vise ved et værktøj. */
function slags(navn) {
  return { dato_og_tid: 'tid', regn: 'regn', gem_note: 'note', find_noter: 'note', slet_note: 'note' }[navn] || 'andet';
}

const dollar = (beloeb) => `${beloeb.toLocaleString('da-DK', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} dollar`;

/** Kilder fra søgningen. OpenRouter sender dem som "url_citation"-annotationer. */
function samlKilder(annotationer, kilder) {
  for (const a of annotationer || []) {
    if (!a || a.type !== 'url_citation') continue;
    const c = a.url_citation || a;
    if (typeof c.url === 'string' && /^https:\/\//i.test(c.url) && !kilder.has(c.url)) {
      kilder.set(c.url, { url: c.url, titel: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : c.url });
    }
  }
}

/**
 * Kører én runde: sender samtalen til modellen og samler svaret op.
 * Teksten sendes videre til browseren, mens den bliver skrevet.
 */
async function koerRunde({ kaldModel, forespoergsel, signal, send, id }) {
  let tekst = '';
  let usage = null;
  let slutGrund = null;
  const kald = [];
  const kilder = new Map();

  for await (const chunk of kaldModel(forespoergsel, signal)) {
    if (chunk.usage) usage = chunk.usage;
    const valg = chunk.choices && chunk.choices[0];
    if (!valg) continue;
    const delta = valg.delta || valg.message || {};
    if (typeof delta.content === 'string' && delta.content) {
      tekst += delta.content;
      send({ type: 'tekst', id, tekst });
    }
    // Værktøjskald kommer i stykker: navn og id først, argumenterne lidt ad gangen
    for (const del of delta.tool_calls || []) {
      const nr = Number.isInteger(del.index) ? del.index : kald.length;
      const k = kald[nr] || (kald[nr] = { id: '', navn: '', argumenter: '' });
      if (del.id) k.id = del.id;
      if (del.function && del.function.name && !k.navn) k.navn = del.function.name;
      if (del.function && typeof del.function.arguments === 'string') k.argumenter += del.function.arguments;
    }
    samlKilder(delta.annotations, kilder);
    if (valg.finish_reason) slutGrund = valg.finish_reason;
  }

  return {
    tekst,
    usage,
    slutGrund,
    kald: kald.filter((k) => k && k.navn).map((k, i) => ({ ...k, id: k.id || `kald_${id}_${i}` })),
    kilder: [...kilder.values()],
  };
}

/**
 * @param {object} p
 * @param {{ beskeder: object[], brugt: number }} p.samtale  samtalen indtil nu (bliver opdateret)
 * @param {string} p.tekst                    brugerens besked
 * @param {(forespoergsel: object, signal?: AbortSignal) => AsyncIterable<object>} p.kaldModel
 * @param {{ model: string, vaerktoejer: object[], budgetDollar?: number }} p.indstillinger
 * @param {{ koer: (navn: string, input: object) => string }} p.vaerktoejer
 * @param {(besked: object) => void} p.send   sender en besked videre til browseren
 * @param {AbortSignal} [p.signal]            stopper turen
 */
async function koerTur({ samtale, tekst, kaldModel, indstillinger, vaerktoejer, send, signal }) {
  const foer = samtale.beskeder.length;
  let turPris = 0;
  samtale.beskeder.push({ role: 'user', content: tekst });

  try {
    for (let runde = 1; runde <= MAKS_RUNDER; runde++) {
      if (indstillinger.budgetDollar && samtale.brugt >= indstillinger.budgetDollar) {
        send({ type: 'advarsel', tekst: `Samtalen har brugt sit budget på ${dollar(indstillinger.budgetDollar)}. Start en ny samtale, eller hæv budgettet med npm run opsaet.` });
        return { pris: turPris };
      }

      const id = `${Date.now().toString(36)}-${runde}`;
      const svar = await koerRunde({
        kaldModel,
        signal,
        send,
        id,
        forespoergsel: {
          model: indstillinger.model,
          messages: [{ role: 'system', content: SYSTEM }, ...samtale.beskeder],
          tools: indstillinger.vaerktoejer,
          max_tool_calls: MAKS_SERVERKALD,
          max_tokens: MAKS_TOKENS,
        },
      });

      const pris = Number(svar.usage && svar.usage.cost) || 0;
      turPris += pris;
      samtale.brugt += pris;
      const soegninger = svar.usage && svar.usage.server_tool_use_details && svar.usage.server_tool_use_details.web_search_requests;
      if (soegninger) send({ type: 'aktivitet', slags: 'soeg', tekst: soegninger === 1 ? 'Søgte på nettet 1 gang' : `Søgte på nettet ${soegninger} gange` });

      const besked = { role: 'assistant', content: svar.tekst || null };
      if (svar.kald.length) {
        besked.tool_calls = svar.kald.map((k) => ({ id: k.id, type: 'function', function: { name: k.navn, arguments: k.argumenter || '{}' } }));
      }
      samtale.beskeder.push(besked);
      if (svar.tekst) send({ type: 'tekst', id, tekst: svar.tekst, faerdig: true });

      if (!svar.kald.length) {
        // Står kilderne ikke allerede i svaret, så viser vi dem fra søgningen
        const mangler = svar.kilder.filter((k) => !svar.tekst.includes(k.url));
        if (mangler.length) send({ type: 'kilder', kilder: mangler.slice(0, 8) });
        if (svar.slutGrund === 'length') send({ type: 'advarsel', tekst: 'Svaret blev afbrudt, fordi det blev for langt. Spørg om en mindre del ad gangen.' });
        if (!svar.tekst) send({ type: 'advarsel', tekst: 'Modellen svarede ikke. Prøv igen, eller vælg en anden model.' });
        send({ type: 'info', tekst: `Pris for svaret: ${dollar(turPris)} · samtalen i alt: ${dollar(samtale.brugt)}` });
        return { pris: turPris };
      }

      for (const k of svar.kald) {
        if (signal && signal.aborted) throw Object.assign(new Error('Stoppet'), { name: 'AbortError' });
        let input = null;
        try { input = JSON.parse(k.argumenter || '{}'); } catch (e) { input = null; }
        let resultat;
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          resultat = 'Fejl: argumenterne var ikke gyldig JSON. Prøv igen.';
        } else {
          send({ type: 'aktivitet', slags: slags(k.navn), tekst: beskrivVaerktoej(k.navn, input) });
          try {
            resultat = String(await vaerktoejer.koer(k.navn, input));
          } catch (e) {
            resultat = `Fejl: ${e.message}`;
          }
        }
        samtale.beskeder.push({ role: 'tool', tool_call_id: k.id, content: resultat });
      }
    }
    send({ type: 'advarsel', tekst: 'AI\'en brugte for mange skridt uden at blive færdig. Prøv at stille spørgsmålet mere præcist.' });
    return { pris: turPris };
  } catch (e) {
    // Gik turen galt, fjerner vi den fra samtalen, så næste spørgsmål starter rent
    samtale.beskeder.length = foer;
    throw e;
  }
}

module.exports = { koerTur, koerRunde, beskrivVaerktoej, slags, samlKilder, MAKS_RUNDER };
