'use strict';

/*
 * Én "tur" i samtalen: brugeren skriver noget, og AI'en arbejder, indtil den har svaret.
 *
 * Vi åbner hændelsesstrømmen fra Anthropic FØR vi sender beskeden, så vi ikke går glip af noget.
 * Undervejs oversætter vi hændelserne til små beskeder til browseren (send) og
 * svarer AI'en, når den vil bruge vores egne værktøjer eller skal have lov til noget.
 */

const MAKS_VIST = 140;

function kort(tekst) {
  const t = String(tekst ?? '').replace(/\s+/g, ' ').trim();
  return t.length > MAKS_VIST ? t.slice(0, MAKS_VIST - 1) + '…' : t;
}

/** En læsbar beskrivelse af, hvad AI'en er i gang med. */
function beskrivVaerktoej(navn, input = {}) {
  switch (navn) {
    case 'web_search': return `Søger efter "${kort(input.query ?? input.q ?? JSON.stringify(input))}"`;
    case 'web_fetch': return `Læser ${kort(input.url ?? JSON.stringify(input))}`;
    case 'bash': return `Regner: ${kort(input.command ?? JSON.stringify(input))}`;
    case 'dato_og_tid': return 'Tjekker dato og klokkeslæt';
    case 'gem_note': return `Husker: ${kort(input.tekst)}`;
    case 'find_noter': return input.ord ? `Leder i dine noter efter "${kort(input.ord)}"` : 'Kigger i dine noter';
    case 'slet_note': return `Sletter note ${kort(input.id)}`;
    default: return `Bruger ${navn}`;
  }
}

/** Hvilket ikon browseren skal vise ved et værktøj. */
function slags(navn) {
  return { web_search: 'soeg', web_fetch: 'laes', bash: 'regn', dato_og_tid: 'tid', gem_note: 'note', find_noter: 'note', slet_note: 'note' }[navn] || 'andet';
}

const SLUT_TEKST = {
  budget_reached: 'Samtalen har brugt hele sit budget. Start en ny samtale, eller hæv budgettet i indstillinger.json.',
  retries_exhausted: 'AI\'en kunne ikke få forbindelse til modellen. Prøv igen om lidt.',
  refusal: 'AI\'en ville ikke svare på det spørgsmål.',
};

/**
 * @param {object} p
 * @param {import('@anthropic-ai/sdk').default} p.client
 * @param {string} p.sessionId
 * @param {string} p.tekst                  brugerens besked
 * @param {(besked: object) => void} p.send  sender en besked videre til browseren
 * @param {(spoergsmaal: {id: string, beskrivelse: string}) => Promise<boolean>} p.spoerg  beder brugeren om lov
 * @param {{ koer: (navn: string, input: object) => string }} p.vaerktoejer
 * @returns {Promise<{ afsluttet: boolean }>}
 */
async function koerTur({ client, sessionId, tekst, send, spoerg, vaerktoejer }) {
  const events = client.beta.sessions.events;
  const stream = await events.stream(sessionId, { event_deltas: ['agent.message'] });
  await events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: tekst }] }],
  });

  // Tekst, der er på vej, før den færdige besked kommer
  const igang = new Map();

  for await (const event of stream) {
    switch (event.type) {
      case 'event_start':
        if (event.event.type === 'agent.message') igang.set(event.event.id, '');
        break;

      case 'event_delta': {
        if (!igang.has(event.event_id) || event.delta.type !== 'content_delta') break;
        if (event.delta.content.type !== 'text') break;
        const samlet = igang.get(event.event_id) + event.delta.content.text;
        igang.set(event.event_id, samlet);
        send({ type: 'tekst', id: event.event_id, tekst: samlet });
        break;
      }

      case 'agent.message': {
        // Den færdige besked er altid den rigtige – den erstatter teksten, der var på vej
        igang.delete(event.id);
        const samlet = event.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
        send({ type: 'tekst', id: event.id, tekst: samlet, faerdig: true });
        break;
      }

      case 'span.model_request_end':
        // Blev et svar afbrudt, kommer den færdige besked aldrig. Så afslutter vi det, vi har.
        for (const [id, samlet] of igang) send({ type: 'tekst', id, tekst: samlet, faerdig: true });
        igang.clear();
        break;

      case 'agent.tool_use': {
        const beskrivelse = beskrivVaerktoej(event.name, event.input);
        if (event.evaluated_permission === 'deny') {
          send({ type: 'aktivitet', id: event.id, slags: slags(event.name), tekst: `${beskrivelse} (stoppet af sikkerhedstjekket)` });
          break;
        }
        send({ type: 'aktivitet', id: event.id, slags: slags(event.name), tekst: beskrivelse });
        if (event.evaluated_permission === 'ask') {
          const ok = await spoerg({ id: event.id, beskrivelse });
          await events.send(sessionId, {
            events: [ok
              ? { type: 'user.tool_confirmation', tool_use_id: event.id, result: 'allow' }
              : { type: 'user.tool_confirmation', tool_use_id: event.id, result: 'deny', deny_message: 'Brugeren sagde nej. Find en anden måde.' }],
          });
        }
        break;
      }

      case 'agent.custom_tool_use': {
        send({ type: 'aktivitet', id: event.id, slags: slags(event.name), tekst: beskrivVaerktoej(event.name, event.input) });
        let resultat;
        let fejl = false;
        try {
          resultat = await vaerktoejer.koer(event.name, event.input || {});
        } catch (e) {
          resultat = `Fejl: ${e.message}`;
          fejl = true;
        }
        await events.send(sessionId, {
          events: [{
            type: 'user.custom_tool_result',
            custom_tool_use_id: event.id,
            content: [{ type: 'text', text: String(resultat) }],
            is_error: fejl,
          }],
        });
        break;
      }

      case 'session.error': {
        const besked = event.error && event.error.message ? event.error.message : 'Ukendt fejl';
        const proeverIgen = event.error && event.error.retry_status && event.error.retry_status.type === 'retrying';
        send({ type: 'advarsel', tekst: proeverIgen ? `${besked} (prøver igen …)` : besked });
        break;
      }

      case 'session.status_idle': {
        const grund = event.stop_reason && event.stop_reason.type;
        if (grund === 'requires_action') break; // venter på et svar fra os – det sender vi ovenfor
        if (SLUT_TEKST[grund]) send({ type: 'advarsel', tekst: SLUT_TEKST[grund] });
        return { afsluttet: false };
      }

      case 'session.status_terminated':
        send({ type: 'advarsel', tekst: 'Samtalen er afsluttet. Start en ny samtale.' });
        return { afsluttet: true };

      default:
        break;
    }
  }
  // Strømmen lukkede, uden at AI'en blev færdig
  send({ type: 'advarsel', tekst: 'Forbindelsen til AI\'en blev afbrudt. Prøv at sende beskeden igen.' });
  return { afsluttet: false };
}

module.exports = { koerTur, beskrivVaerktoej, slags };
