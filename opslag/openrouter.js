'use strict';

/*
 * Forbindelsen til OpenRouter (https://openrouter.ai), der giver adgang til
 * mange forskellige AI-modeller gennem ét API.
 *
 * Vi bruger Chat Completions-API'et med streaming: svaret kommer som
 * Server-Sent Events, hvor hver linje "data: {...}" er et lille stykke af svaret.
 */

const API = 'https://openrouter.ai/api/v1';

class OpenRouterFejl extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'OpenRouterFejl';
    this.status = status ?? null;
  }
}

/** En forklaring på dansk ud fra HTTP-statuskoden. */
function forklarStatus(status, besked) {
  switch (status) {
    case 400: return `OpenRouter afviste forespørgslen: ${besked}`;
    case 401: return 'OpenRouter kunne ikke genkende din API-nøgle. Tjek OPENROUTER_API_KEY, og genstart serveren.';
    case 402: return 'Der er ikke flere credits på din OpenRouter-konto. Fyld op på https://openrouter.ai/settings/credits.';
    case 403: return `OpenRouter blokerede forespørgslen: ${besked}`;
    case 404: return `OpenRouter kender ikke modellen: ${besked}. Vælg en anden med npm run opsaet.`;
    case 408: return 'OpenRouter brugte for lang tid. Prøv igen.';
    case 429: return 'For mange forespørgsler lige nu. Vent lidt, og prøv igen.';
    case 502: return 'Modellen svarer ikke lige nu. Prøv igen om lidt, eller vælg en anden model.';
    case 503: return 'Ingen udbyder kan køre modellen lige nu. Prøv igen om lidt, eller vælg en anden model.';
    default: return `Fejl fra OpenRouter (${status}): ${besked}`;
  }
}

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-OpenRouter-Title': 'Opslag', // valgfrit: navnet på appen i OpenRouters oversigter
  };
}

async function fejlFraSvar(res) {
  let besked = res.statusText || 'ukendt fejl';
  try {
    const data = await res.json();
    if (data && data.error && data.error.message) besked = data.error.message;
  } catch (e) { /* svaret var ikke JSON */ }
  return new OpenRouterFejl(forklarStatus(res.status, besked), res.status);
}

async function hent(url, valg, f) {
  try {
    return await f(url, valg);
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new OpenRouterFejl('Kunne ikke få forbindelse til OpenRouter. Tjek din internetforbindelse.');
  }
}

/**
 * Sender en chat-forespørgsel og giver svaret tilbage stykke for stykke.
 * @param {{ apiKey: string, body: object, signal?: AbortSignal, fetch?: typeof fetch }} p
 * @returns {AsyncGenerator<object>} hvert "chat.completion.chunk"
 */
async function* chatStream({ apiKey, body, signal, fetch: f = globalThis.fetch }) {
  const res = await hent(`${API}/chat/completions`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  }, f);
  if (!res.ok) throw await fejlFraSvar(res);

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const stykke of res.body) {
    buffer += typeof stykke === 'string' ? stykke : decoder.decode(stykke, { stream: true });
    let slut;
    while ((slut = buffer.indexOf('\n')) >= 0) {
      const linje = buffer.slice(0, slut).trim();
      buffer = buffer.slice(slut + 1);
      // Tomme linjer og kommentarer som ": OPENROUTER PROCESSING" holder bare forbindelsen i live
      if (!linje || linje.startsWith(':') || !linje.startsWith('data:')) continue;
      const data = linje.slice(5).trim();
      if (data === '[DONE]') return;
      let chunk;
      try { chunk = JSON.parse(data); } catch (e) { continue; }
      if (chunk.error) {
        const status = Number(chunk.error.code) || null;
        throw new OpenRouterFejl(status ? forklarStatus(status, chunk.error.message) : `Fejl fra OpenRouter: ${chunk.error.message}`, status);
      }
      yield chunk;
    }
  }
}

/** Tjekker API-nøglen. Giver oplysninger om nøglen tilbage, eller kaster en fejl. */
async function tjekNoegle({ apiKey, fetch: f = globalThis.fetch }) {
  const res = await hent(`${API}/key`, { headers: headers(apiKey) }, f);
  if (!res.ok) throw await fejlFraSvar(res);
  const data = await res.json();
  return data && data.data ? data.data : data;
}

/** Henter listen over modeller. Kræver ingen nøgle. */
async function hentModeller({ fetch: f = globalThis.fetch } = {}) {
  const res = await hent(`${API}/models`, {}, f);
  if (!res.ok) throw await fejlFraSvar(res);
  return (await res.json()).data || [];
}

module.exports = { chatStream, tjekNoegle, hentModeller, OpenRouterFejl, forklarStatus };
