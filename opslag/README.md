# Opslag

En AI, der finder ting og slår ting op for folk. Den søger på nettet, læser siderne og viser altid, hvor svaret kommer fra. Den kan også regne, tjekke datoen og huske ting for dig ("Husk at reservenøglen ligger under urtepotten").

Opslag findes i to versioner:

| | Med websøgning (denne mappe) | Gratis version |
| --- | --- | --- |
| Søger på nettet og læser sider | Ja | Nej, svarer ud fra Claudes viden |
| Viser kilder med links | Ja | Når den kender dem |
| Regner, omregner og tæller dage | Ja | Ja |
| Husker noter for dig | Ja, i `noter.json` på din computer | Ja, privat på din claude.ai-konto |
| Kræver API-nøgle | Ja, og hvert spørgsmål koster lidt | Nej, kører på claude.ai |

## Kom i gang med websøgning

Du skal bruge [Node.js](https://nodejs.org) 18 eller nyere og en API-nøgle fra Anthropic.

1. **Lav en API-nøgle** på <https://console.anthropic.com/settings/keys>. Du skal have penge på kontoen under *Billing*.
2. **Gør nøglen tilgængelig** i terminalen:
   ```sh
   export ANTHROPIC_API_KEY="din-nøgle"        # macOS og Linux
   setx ANTHROPIC_API_KEY "din-nøgle"          # Windows (åbn derefter en ny terminal)
   ```
3. **Installér og sæt op** (kun første gang):
   ```sh
   cd opslag
   npm install
   npm run opsaet
   ```
   Opsætningen spørger, om Opslag må søge på hele internettet:
   - **j**: AI'en kan finde alt. Maskinen, hvor den regner, får også fri adgang til nettet, så læg aldrig hemmeligheder derind.
   - **n**: AI'en må kun bruge en liste med udvalgte sider som wikipedia.org, dr.dk, borger.dk og dmi.dk. Det er mere sikkert, men den finder færre ting. Listen står øverst i `agent.js`.
4. **Start Opslag**:
   ```sh
   npm start
   ```
   Åbn <http://localhost:3000> i din browser.

Ændrer du noget i `agent.js`, fx instruktionerne eller listen over sider, så kør `npm run opsaet` igen. Agenten bliver opdateret og beholder sit id.

## Hvad koster det?

Opslag bruger modellen Claude Opus 5.5. Du betaler for:
- tekst, som AI'en læser og skriver ($4 pr. million ord-stykker ind og $20 ud)
- websøgninger ($10 pr. 1.000 søgninger)
- den tid, samtalen kører ($0,08 i timen)

Et almindeligt spørgsmål koster typisk et par cent. **Hver samtale har et loft på 1 dollar.** Når loftet er nået, stopper AI'en og siger til. Du kan ændre loftet i `indstillinger.json` (`budgetCent`, fx `200` for 2 dollar). Det gælder for nye samtaler.

## Sådan virker det

Opslag er bygget med **Claude Managed Agents**. Anthropic kører selve AI'ens arbejdsgang og en lille maskine pr. samtale, hvor dens værktøjer kører. Det er i beta. Samtalerne bliver gemt hos Anthropic, indtil du sletter dem, og du kan se dem i [Console](https://platform.claude.com) under *Managed Agents → Sessions*. Serveren skriver et link i terminalen, hver gang en ny samtale starter.

```
Browser  ⇄  server.js (din computer, din nøgle)  ⇄  Anthropic (agenten, websøgning)
```

| Fil | Hvad den gør |
| --- | --- |
| `agent.js` | Agentens instruktioner, model og værktøjer, og listen over udvalgte sider |
| `opsaet.js` | Opretter miljø og agent én gang og gemmer id'erne i `indstillinger.json` |
| `server.js` | Webserveren. Starter samtaler og sender beskeder videre |
| `tur.js` | Én tur i samtalen: læser AI'ens hændelser, kører vores værktøjer og spørger dig om lov |
| `vaerktoejer.js` | Værktøjer, der kører på din computer: dato og tid samt noter |
| `public/` | Chatvinduet (`index.html`, `ui.js`, `stil.css`) |
| `gratis.html` | Den gratis version, der kører på claude.ai |
| `test/` | Tests, der bruger en falsk AI, så de ikke koster noget |

**Sikkerhed:**
- Serveren lytter kun på din egen computer (127.0.0.1), og API-nøglen forlader aldrig serveren.
- Anthropic tjekker hvert værktøjskald. Er det usikkert, bliver det stoppet. Er det uklart, bliver du spurgt i chatten, før det sker.

## Tests

```sh
npm test
```

Testene bruger en falsk Anthropic-klient, så de virker uden nøgle og koster ingenting.

## Hvis noget går galt

- **"API-nøglen virker ikke"**: Tjek, at `ANTHROPIC_API_KEY` er sat i den terminal, hvor du starter serveren.
- **"Opslag er ikke sat op endnu"**: Kør `npm run opsaet`.
- **Opsætningen nævner en side på listen**: Fjern siden fra `UDVALGTE_SIDER` i `agent.js`, og kør opsætningen igen.
- **"Samtalen har brugt hele sit budget"**: Start en ny samtale, eller hæv `budgetCent`.
