# Opslag

En AI, der finder ting og slår ting op for folk. Den søger på nettet, læser siderne og viser, hvor svaret kommer fra. Den kan også regne, tjekke datoen og huske ting for dig ("Husk at reservenøglen ligger under urtepotten").

Opslag bruger [OpenRouter](https://openrouter.ai), der giver adgang til hundredvis af AI-modeller gennem én nøgle. Som standard bruger den Claude Opus 5.5, men du kan vælge en billigere eller gratis model.

Der findes også en **gratis version**, der kører på claude.ai uden nøgle (`gratis.html`). Den kan ikke søge på nettet.

## Kom i gang

Du skal bruge [Node.js](https://nodejs.org) 18 eller nyere. Opslag har ingen andre afhængigheder.

1. **Lav en nøgle** på <https://openrouter.ai/settings/keys>, og køb credits på <https://openrouter.ai/settings/credits>. Fem dollar rækker langt (se priser nedenfor).
2. **Gør nøglen tilgængelig** i terminalen:
   ```sh
   export OPENROUTER_API_KEY="din-nøgle"       # macOS og Linux
   setx OPENROUTER_API_KEY "din-nøgle"         # Windows (åbn derefter en ny terminal)
   ```
3. **Vælg indstillinger** (kan springes over – så bruges standardværdierne):
   ```sh
   cd opslag
   npm run opsaet
   ```
   Opsætningen tjekker din nøgle og spørger om tre ting:
   - **Model**: Claude Opus 5.5 (klogest), Claude Sonnet 5.5 (cirka halv pris), Claude Haiku 5.5 (meget billig), eller et hvilket som helst model-id fra <https://openrouter.ai/models>, der kan bruge værktøjer.
   - **Hjemmesider**: hele internettet eller kun en liste med udvalgte sider som wikipedia.org, dr.dk og borger.dk. Listen står øverst i `agent.js`.
   - **Budget**: hvor mange dollar én samtale højst må koste. Standard er 1 dollar.
4. **Start Opslag**:
   ```sh
   npm start
   ```
   Åbn <http://localhost:3000> i din browser.

## Hvad koster det?

Du betaler OpenRouter for den tekst, modellen læser og skriver, og for websøgninger. Under hvert svar står, hvad det kostede, og hvad samtalen har kostet i alt.

Målt med den rigtige OpenRouter, da Opslag blev bygget:

| Spørgsmål | Model | Pris |
| --- | --- | --- |
| "Hvilken ugedag er det, hvad er 1299 kr. minus 20 %, og husk min cykelkode" (3 egne værktøjer) | en gratis model | 0 dollar |
| "Hvad er Rundetårns åbningstider?" (1 websøgning med Exa) | en gratis model | 0,007 dollar |
| "Hvilken dato er det, og hvad er Rundetårns åbningstider?" (1 websøgning med Claudes egen søgning) | Claude Opus 5.5 | 0,205 dollar |

Det sidste svar var dyrt, fordi Claudes egen søgning sendte næsten 39.000 tokens fra hele hjemmesider med. Derfor bruger Opslag nu søgemaskinen Exa, der kun sender korte uddrag. Med Opus forventer vi omkring 0,03-0,05 dollar for et spørgsmål med én søgning, men det er ikke målt endnu. Vælg Sonnet eller Haiku, hvis det skal være billigere.

Når en samtale når sit budget, stopper Opslag og siger til. Start så en ny samtale.

## Sådan virker det

```
Browser  ⇄  server.js (din computer, din nøgle)  ⇄  OpenRouter  ⇄  modellen
```

Hvert spørgsmål kører i runder. Serveren sender samtalen til modellen gennem OpenRouter. Vil modellen søge på nettet eller læse en side, klarer OpenRouter det selv undervejs. Vil den bruge et af vores egne værktøjer (dato, regning eller noter), kører serveren værktøjet og sender resultatet tilbage i en ny runde. Når modellen svarer med tekst, er spørgsmålet færdigt.

| Fil | Hvad den gør |
| --- | --- |
| `agent.js` | Instruktioner, standardmodel, værktøjer og listen over udvalgte sider |
| `openrouter.js` | Forbindelsen til OpenRouter: streaming og danske fejlbeskeder |
| `tur.js` | Ét spørgsmål: runderne, værktøjerne, budgettet og prisen |
| `vaerktoejer.js` | Egne værktøjer: dato og tid, udregninger med Hygge og noter i `noter.json` |
| `server.js` | Webserveren, der forbinder browseren og OpenRouter |
| `opsaet.js` | Vælger model, hjemmesider og budget og gemmer dem i `indstillinger.json` |
| `public/` | Chatvinduet (`index.html`, `ui.js`, `stil.css`) |
| `gratis.html` | Den gratis version, der kører på claude.ai |
| `test/` | Tests med en falsk OpenRouter, så de ikke koster noget |

Samtaler bliver kun gemt, mens serveren kører. Noterne bliver gemt i `noter.json`, så de overlever en genstart.

**Sikkerhed:**
- Serveren lytter kun på din egen computer (127.0.0.1), og nøglen forlader aldrig serveren.
- Opslags egne værktøjer kan kun læse datoen, regne og gemme noter. Websøgning og sidelæsning sker hos OpenRouter, ikke på din computer.

## Tests

```sh
npm test
```

## Hvis noget går galt

- **"OpenRouter kunne ikke genkende din API-nøgle"**: Tjek, at `OPENROUTER_API_KEY` er sat i den terminal, hvor du starter serveren.
- **"Der er ikke flere credits"**: Fyld op på <https://openrouter.ai/settings/credits>, eller vælg en gratis model med `npm run opsaet`.
- **"OpenRouter kender ikke modellen"**: Kør `npm run opsaet`, og vælg en model fra listen.
- **"Samtalen har brugt sit budget"**: Start en ny samtale, eller hæv budgettet med `npm run opsaet`.
- **Gratis modeller** kan være langsomme eller have travlt. Prøv igen, eller vælg en anden.
