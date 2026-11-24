/*
 * Eksempelprogrammer til Hygge. Bruges af editoren (index.html),
 * kommandolinjen (cli.js) og testene.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HyggeEksempler = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return [
    {
      id: 'velkommen',
      titel: 'Velkommen',
      kode: `# Velkommen til Hygge – et programmeringssprog på dansk!
# Tryk på "Kør" for at køre programmet. Prøv så at ændre noget.

skriv "Hej verden!"

sæt navn = "Freja"
sæt alder = 13
skriv "Jeg hedder", navn, "og er", alder, "år gammel."
skriv "Om 10 år er jeg", alder + 10

hvis alder >= 13 {
    skriv navn + " er teenager."
} ellers {
    skriv navn + " er ikke teenager endnu."
}

# Skildpadden tegner en stjerne på papiret
pen_op()
gå_til(-15, -75)
pen_ned()
farve("rød")
tykkelse(3)
gentag 5 gange {
    fremad(150)
    drej_højre(144)
}
`,
    },
    {
      id: 'regning',
      titel: 'Regning og variabler',
      kode: `# En variabel er en kasse med et navn, som du kan lægge en værdi i.
sæt a = 17
sæt b = 5

skriv a, "+", b, "=", a + b
skriv a, "-", b, "=", a - b
skriv a, "*", b, "=", a * b
skriv a, "/", b, "=", a / b
skriv "Resten, når", a, "deles med", b, "er", a % b
skriv "2 opløftet i 10 er", 2 ^ 10
skriv "Kvadratroden af 144 er", kvadratrod(144)

# Du kan ændre en variabel med += og -=
sæt penge = 100
sæt penge -= 35
sæt penge += 20
skriv "Jeg har", penge, "kr. tilbage."

# Decimaltal skrives med punktum
sæt pris = 49.95
skriv "3 stk. koster", afrund(pris * 3, 2), "kr."
`,
    },
    {
      id: 'hvis',
      titel: 'Hvis og ellers',
      kode: `# Programmet vælger, hvad det skal gøre, ud fra en betingelse.
sæt temperatur = 8

hvis temperatur < 0 {
    skriv "Det fryser! Tag hue og vanter på."
} ellers hvis temperatur < 10 {
    skriv "Det er koldt. Tag en jakke på."
} ellers hvis temperatur < 20 {
    skriv "Det er fint vejr."
} ellers {
    skriv "Det er varmt! Husk solcreme."
}

# Du kan kombinere betingelser med og, eller og ikke
sæt har_cykel = sandt
sæt regner = falsk

hvis har_cykel og ikke regner {
    skriv "Du kan cykle i skole i dag."
}

hvis temperatur = 8 {
    skriv "Det er præcis 8 grader."
}
`,
    },
    {
      id: 'løkker',
      titel: 'Løkker',
      kode: `# En løkke gentager noget mange gange.

gentag 3 gange {
    skriv "Hip hip hurra!"
}

skriv ""
skriv "Gangetabellen for 7:"
for i fra 1 til 10 {
    skriv i, "x 7 =", i * 7
}

skriv ""
skriv "Nedtælling:"
sæt n = 5
mens n > 0 {
    skriv n
    sæt n -= 1
}
skriv "Affyring!"

skriv ""
skriv "Lige tal op til 20:"
for x fra 0 til 20 trin 2 {
    skriv x
}
`,
    },
    {
      id: 'lister',
      titel: 'Lister',
      kode: `# En liste gemmer flere værdier i rækkefølge.
sæt indkøb = ["mælk", "rugbrød", "æbler"]
tilføj(indkøb, "ost")

skriv "Jeg skal købe", længde(indkøb), "ting:"
for hver ting i indkøb {
    skriv "-", ting
}

# Pladserne tælles fra 0. -1 er den sidste.
skriv "Første ting:", indkøb[0]
skriv "Sidste ting:", indkøb[-1]
skriv "I alfabetisk orden:", sorter(indkøb)

sæt point = [12, 7, 19, 3]
skriv "Højeste:", størst(point)
skriv "Laveste:", mindst(point)
skriv "I alt:", sum(point)
skriv "Gennemsnit:", sum(point) / længde(point)
`,
    },
    {
      id: 'funktioner',
      titel: 'Funktioner',
      kode: `# En funktion er en opskrift, du kan bruge igen og igen.
funktion areal(bredde, højde) {
    returner bredde * højde
}

skriv "Et værelse på 4 x 5 meter er", areal(4, 5), "m²"

funktion hils(navn) {
    returner "Hej " + navn + "!"
}

for hver person i ["Ida", "Malik", "Sofie"] {
    skriv hils(person)
}

# En funktion kan kalde sig selv. Det hedder rekursion.
funktion fakultet(n) {
    hvis n <= 1 {
        returner 1
    }
    returner n * fakultet(n - 1)
}

for i fra 1 til 10 {
    skriv i + "! =", fakultet(i)
}
`,
    },
    {
      id: 'gæt',
      titel: 'Gæt et tal',
      kode: `# Computeren tænker på et tal, og du skal gætte det.
sæt hemmeligt = tilfældig(1, 100)
sæt forsøg = 0
skriv "Jeg tænker på et tal mellem 1 og 100."

mens sandt {
    sæt gæt = tal(spørg("Dit gæt:"))
    sæt forsøg += 1
    hvis gæt < hemmeligt {
        skriv gæt, "er for lavt."
    } ellers hvis gæt > hemmeligt {
        skriv gæt, "er for højt."
    } ellers {
        skriv "Rigtigt! Du brugte", forsøg, "forsøg."
        stop
    }
}
`,
    },
    {
      id: 'bipbop',
      titel: 'Bip Bop',
      kode: `# Tæl fra 1 til 30.
# Tal, der kan deles med 3, bliver til "Bip".
# Tal, der kan deles med 5, bliver til "Bop".
# Tal, der kan deles med begge, bliver til "BipBop".

for i fra 1 til 30 {
    hvis i % 15 = 0 {
        skriv "BipBop"
    } ellers hvis i % 3 = 0 {
        skriv "Bip"
    } ellers hvis i % 5 = 0 {
        skriv "Bop"
    } ellers {
        skriv i
    }
}
`,
    },
    {
      id: 'spiral',
      titel: 'Tegning: Regnbuespiral',
      kode: `# Skildpadden går lidt længere for hver streg og drejer næsten en sjettedel.
sæt farver = ["rød", "orange", "gul", "grøn", "blå", "lilla"]
baggrund("sort")
tykkelse(2)

for i fra 1 til 180 {
    farve(farver[i % 6])
    fremad(i)
    drej_højre(59)
}
`,
    },
    {
      id: 'blomst',
      titel: 'Tegning: Blomst af firkanter',
      kode: `# En funktion, der tegner en firkant
funktion firkant(størrelse) {
    gentag 4 gange {
        fremad(størrelse)
        drej_højre(90)
    }
}

sæt farver = ["rød", "orange", "gul", "grøn", "blå", "lilla"]

# 36 firkanter, der hver er drejet 10 grader
for i fra 0 til 35 {
    farve(farver[i % længde(farver)])
    firkant(120)
    drej_højre(10)
}

farve("gul")
cirkel(18, sandt)
`,
    },
  ];
});
