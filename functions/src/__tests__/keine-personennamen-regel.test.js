const de = require("../locales/de/prompts");
const en = require("../locales/en/prompts");

/**
 * Sichert die Regel "keine Namen, keine Zuordnung zu einer realen Person" in
 * BEIDEN Sprachen ab (PRIV-2026-10-03-07).
 *
 * Die Datenschutzerklaerung sagt zu, dass die KI nicht erkennt, wessen
 * Gesicht ein Foto zeigt. Die Anweisung an die KI verlangt zugleich, sichtbaren
 * Text wortgenau zu lesen — auch Namensschilder und Aufdrucke (fuer das Feld
 * visible_text, aus dem die Hinweise "dein Foto verraet …" entstehen). Damit
 * ein gelesener Name oder ein bekanntes Gesicht nicht als Identitaet im Profil
 * landet, steht das Verbot ausdruecklich bei den gemeinsamen Regeln beider
 * Modi. Die Regel im Prompt ist der einzige Schutz dafuer; dieser Test haelt
 * fest, dass sie in beiden Sprachen steht und das Lesen fuer visible_text
 * nicht zuruecknimmt.
 */

const SPRACHEN = [
  [
    "de",
    de.singleLargePrompt,
    {
      abschnitt: "═══ GEMEINSAME REGELN FÜR BEIDE MODI ═══",
      zeile:
        "- Nenne NIEMALS den Namen einer abgebildeten Person und ordne sie NIEMALS einer realen Person zu — auch nicht anhand von Namensschildern, Aufdrucken oder weil dir ein Gesicht bekannt vorkommt. Ein gelesener Name gehört in visible_text, nie als Name der Person in ein Profil.",
      lesen: /visible_text: Liste JEDEN[^\n]*Namensschilder/,
    },
  ],
  [
    "en",
    en.singleLargePrompt,
    {
      abschnitt: "═══ COMMON RULES FOR BOTH MODES ═══",
      zeile:
        "- NEVER state the name of a person shown in the photo and NEVER match them to a real person — not from name tags or prints, and not because a face seems familiar. A name you read belongs in visible_text, never in a profile as the person's name.",
      lesen: /visible_text: List EVERY[^\n]*name tags/,
    },
  ],
];

describe.each(SPRACHEN)("Regel gegen Personennamen im Profil (%s)", (_sprache, prompt, soll) => {
  test("der Prompt-Text existiert ueberhaupt (Positivkontrolle)", () => {
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(200);
    expect(prompt).toContain(soll.abschnitt);
  });

  test("die Regel steht woertlich und als eigene Zeile im Prompt", () => {
    expect(prompt.split("\n")).toContain(soll.zeile);
  });

  test("sie steht bei den gemeinsamen Regeln beider Modi, nicht in einem einzelnen Modus", () => {
    const start = prompt.indexOf(soll.abschnitt);
    const ende = prompt.indexOf("═══", start + soll.abschnitt.length);
    expect(prompt.slice(start, ende)).toContain(soll.zeile);
  });

  test("das wortgenaue Lesen von Namensschildern fuer visible_text bleibt verlangt", () => {
    expect(prompt).toMatch(soll.lesen);
  });
});

test("die Regel gibt es in jeder Sprache genau einmal", () => {
  for (const [, prompt, soll] of SPRACHEN) {
    expect(prompt.split(soll.zeile).length - 1).toBe(1);
  }
});
