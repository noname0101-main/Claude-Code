# Hygge

Et lille programmeringssprog på dansk. Det har en editor, der kører i browseren, og en skildpadde, der kan tegne.

```
sæt navn = "Freja"
sæt alder = 13

hvis alder >= 13 {
    skriv navn + " er teenager."
} ellers {
    skriv navn + " er ikke teenager endnu."
}

gentag 5 gange {
    fremad(150)
    drej_højre(144)
}
```

## Prøv det

**I browseren:** Åbn `index.html`. Skriv kode til venstre, og tryk på **Kør** (eller `Ctrl` + `Enter`). Under **Eksempler** ligger ti færdige programmer, du kan lege med.

**I terminalen** (kræver Node.js 18 eller nyere):

```sh
node cli.js --eksempler            # vis alle eksempler
node cli.js --eksempel gæt         # spil "Gæt et tal"
node cli.js mit-program.hygge      # kør din egen fil
```

## Hvad sproget kan

| Det vil du | Sådan skriver du det |
| --- | --- |
| Vise noget | `skriv "Hej", navn` |
| Gemme en værdi | `sæt point = 10` og `sæt point += 1` |
| Regne | `+ - * /`, `%` (rest) og `^` (potens) |
| Vælge | `hvis ... { } ellers hvis ... { } ellers { }` |
| Sammenligne | `= != < > <= >=`, `og`, `eller`, `ikke` |
| Gentage | `gentag 3 gange { }`, `for i fra 1 til 10 { }`, `mens ... { }` |
| Lister | `["æble", "pære"]`, `liste[0]`, `liste[-1]`, `for hver x i liste { }` |
| Funktioner | `funktion hils(navn) { returner "Hej " + navn }` |
| Spørge brugeren | `sæt svar = spørg("Hvad hedder du?")` |
| Tegne | `fremad(100)`, `drej_højre(90)`, `farve("blå")`, `cirkel(40)` |

Der er 37 indbyggede funktioner, bl.a. `længde`, `tilføj`, `sorter`, `tilfældig`, `afrund` og `tal`. De står alle sammen i håndbogen nederst på siden.

Fejlbeskederne er på dansk og prøver at hjælpe:

```
Fejl på linje 2: Jeg kender ikke 'aldre'. Mente du 'alder'?
Fejl på linje 1: Hygge er på dansk: skriv 'skriv' i stedet for 'print'
Fejl på linje 4: Plads 5 findes ikke. Listen har 3 elementer, så pladserne går fra 0 til 2
```

## Sådan virker det indeni

Hygge arbejder i tre trin, ligesom rigtige sprog som Python og JavaScript:

1. **Lexeren** deler koden op i tokens: ord, tal, tekster og tegn.
2. **Parseren** bygger et syntakstræ, der viser, hvordan delene hænger sammen.
3. **Fortolkeren** går træet igennem og udfører programmet.

Du kan se de to første trin for dit eget program under fanerne **Tokens** og **Syntakstræ** i editoren.

| Fil | Hvad den indeholder |
| --- | --- |
| `hygge.js` | Hele sproget: lexer, parser, fortolker og indbyggede funktioner |
| `index.html` | Editoren med farvelagt kode, resultat, tegning og håndbog |
| `eksempler.js` | De ti eksempelprogrammer |
| `cli.js` | Kører Hygge-programmer i terminalen |
| `test/hygge.test.js` | Tests af sproget og alle eksemplerne |

Hygge stopper selv programmer, der kører i ring (over 5 millioner skridt), og funktioner, der kalder sig selv for mange gange. Så hænger browseren ikke.

## Tests

```sh
npm test
```

## Idéer til næste skridt

- En `vent(sekunder)`-kommando, så man kan lave animationer og spil
- Ordbøger (navn → værdi) som en ny datatype
- Tekst med indsatte værdier, fx `"Hej {navn}"`
- En knap, der deler et program med et link
