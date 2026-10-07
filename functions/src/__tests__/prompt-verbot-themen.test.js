/**
 * prompt-verbot-themen.test.js — Filter und Anweisung an die KI nennen
 * dieselben Themen.
 *
 * ANLASS (04.10.2026): Der Kinderschutz-Filter bekam das Thema Drogen
 * (Werbe-Einträge dazu werden bei möglicherweise Minderjährigen gestrichen wie
 * Alkohol). Die Anweisung an die KI nannte Drogen in ihrem Verbotssatz nicht;
 * im Analyse-Aufruf fehlte dort auch Tabak. Für diese Themen gab es damit nur
 * das Netz — die Wortliste —, nicht die Linie davor.
 *
 * Der Filter ist das Netz für den Fall, dass die KI die Anweisung bricht
 * (minor-safety.js, Kopfkommentar). Dazu gehört, dass die Anweisung das Thema
 * überhaupt nennt. Dieser Test hält beides zusammen: Jedes Thema der Stufe 2
 * steht im Verbotssatz beider KI-Aufrufe, deutsch und englisch. Wer dem Filter
 * ein Thema gibt, zieht die Tabelle unten und die Prompts nach.
 *
 * Geprüft wird der Modul-Export, also genau der Text, der an Mistral geht.
 * Reine Textanalyse — kein Netzwerk, keine Cloud.
 */

const de = require("../locales/de/prompts");
const en = require("../locales/en/prompts");
const { MINOR, IMMER } = require("../minor-safety-woerter");

/* Je Thema der Stufe 2 das Wort, an dem der Verbotssatz es nennt. */
const THEMEN = [
  { thema: "Wetten und Glücksspiel", de: /Glücksspiel/, en: /gambling/ },
  { thema: "Kredit und Raten", de: /Kredit/, en: /credit/ },
  { thema: "Alkohol", de: /Alkohol/, en: /alcohol/ },
  { thema: "Tabak", de: /Tabak/, en: /tobacco/ },
  { thema: "Schönheits-OP", de: /Schönheitskorrektur/, en: /cosmetic surgery/ },
  { thema: "Diät", de: /Diät/, en: /diet/ },
  { thema: "Drogen", de: /Drogen/, en: /drugs/ },
];

/* Woran der Verbotssatz je Aufruf und Sprache zu erkennen ist, und wo sein
   Ersatz-Teil beginnt ("stattdessen …"). Ein Wort im Ersatz-Teil zählt nicht:
   Dort stehen die Angebote, die die KI stattdessen nennen soll. */
const VERBOTSSATZ = {
  de: {
    analyse: "- Bei Minderjährigen KEINE Angebote zu ",
    werbung: "zusätzlich KEINE Angebote zu ",
    ersatz: /stattdessen/i,
  },
  en: {
    analyse: "- For minors NO offers involving ",
    werbung: "additionally NO offers involving ",
    ersatz: /instead/i,
  },
};

const AUFRUFE = [
  ["de", "Analyse-Aufruf", de.singleLargePrompt, VERBOTSSATZ.de.analyse],
  ["de", "Werbe-Aufruf", de.beastAdsSystem, VERBOTSSATZ.de.werbung],
  ["en", "Analyse-Aufruf", en.singleLargePrompt, VERBOTSSATZ.en.analyse],
  ["en", "Werbe-Aufruf", en.beastAdsSystem, VERBOTSSATZ.en.werbung],
];

/* Liefert den Verbots-Teil des Satzes (ohne den Ersatz-Teil) oder null, wenn
   der Satz nicht genau einmal im Prompt steht. */
function verbotsTeil(prompt, sprache, anfang) {
  const zeilen = prompt.split("\n").filter((zeile) => zeile.includes(anfang));
  if (zeilen.length !== 1) return null;
  const abAnfang = zeilen[0].slice(zeilen[0].indexOf(anfang));
  const ersatz = abAnfang.search(VERBOTSSATZ[sprache].ersatz);
  return ersatz === -1 ? abAnfang : abAnfang.slice(0, ersatz);
}

/* Welche Themen nennt der Verbots-Teil NICHT? Eine eigene Funktion, damit die
   Gegenprobe unten dieselbe Prüfung gegen einen Satz ohne ein Thema laufen
   lassen kann. */
function fehlendeThemen(teil, sprache) {
  return THEMEN.filter((t) => !t[sprache].test(teil)).map((t) => t.thema);
}

describe("Die Tabelle kennt jedes Thema der Stufe 2", () => {
  test("so viele Zeilen wie Themenlisten im Filter", () => {
    expect(Array.isArray(MINOR.ueberall)).toBe(true);
    expect(THEMEN).toHaveLength(MINOR.ueberall.length);
  });
});

describe.each(AUFRUFE)("Verbotssatz für möglicherweise Minderjährige — %s, %s", (sprache, _aufruf, prompt, anfang) => {
  test("steht genau einmal im Prompt", () => {
    expect(typeof prompt).toBe("string");
    expect(verbotsTeil(prompt, sprache, anfang)).not.toBeNull();
  });

  test("hat einen Ersatz-Teil, der nicht zum Verbot zählt", () => {
    const zeile = prompt.split("\n").find((z) => z.includes(anfang));
    expect(zeile).toMatch(VERBOTSSATZ[sprache].ersatz);
    expect(verbotsTeil(prompt, sprache, anfang).length).toBeLessThan(zeile.length);
  });

  test("nennt jedes Thema, das der Filter bei möglicherweise Minderjährigen streicht", () => {
    expect(fehlendeThemen(verbotsTeil(prompt, sprache, anfang), sprache)).toEqual([]);
  });
});

/* STUFE 1 — gilt für alle (SEC-2026-10-04-26): Pornografie, Waffen und
   Extremismus streicht der Filter bei jedem Alter. Der Werbe-Aufruf nannte
   das Verbot schon; im Analyse-Aufruf, der ebenfalls Werbe-Einträge schreibt,
   stand es nicht — dort war der Filter die einzige Linie. Beide Aufrufe
   nennen jetzt dieselben zwei Sätze; im Analyse-Aufruf stehen sie bei den
   Regeln für die Werbe-Einträge, nicht irgendwo im Text. */
const THEMEN_IMMER = [
  {
    thema: "Pornografie",
    de: /NIEMALS pornografische oder sexualisierte Angebote/,
    en: /NEVER pornographic or sexualised offers/,
  },
  { thema: "Waffen", de: /NIEMALS Waffen, Munition/, en: /NEVER weapons, ammunition/ },
  { thema: "Extremismus", de: /extremistische Inhalte/, en: /extremist content/ },
];

/* Der Teil des Analyse-Aufrufs, der die Werbe-Einträge regelt: von seiner
   Überschrift bis zur nächsten. Im Werbe-Aufruf zählt der ganze Text. */
function werbeRegeln(prompt, aufruf) {
  if (aufruf !== "Analyse-Aufruf") return prompt;
  const anfang = prompt.indexOf("═══ AD_TARGETING");
  if (anfang === -1) return null;
  const ende = prompt.indexOf("═══ ", prompt.indexOf("═══", anfang + 4) + 4);
  return ende === -1 ? prompt.slice(anfang) : prompt.slice(anfang, ende);
}

const fehlendeThemenImmer = (text, sprache) => THEMEN_IMMER.filter((t) => !t[sprache].test(text)).map((t) => t.thema);

describe("Die Tabelle kennt jedes Thema der Stufe 1", () => {
  test("so viele Zeilen wie Themenlisten im Filter", () => {
    expect(Array.isArray(IMMER.ueberall)).toBe(true);
    expect(THEMEN_IMMER).toHaveLength(IMMER.ueberall.length);
  });
});

describe.each(AUFRUFE)("Verbot für alle — %s, %s", (sprache, aufruf, prompt) => {
  test("die Regeln für Werbe-Einträge sind gefunden (Messmittel-Kontrolle)", () => {
    const regeln = werbeRegeln(prompt, aufruf);
    expect(regeln).not.toBeNull();
    expect(regeln).toMatch(/ad_targeting/);
  });

  test("nennt jedes Thema, das der Filter bei jedem Alter streicht", () => {
    expect(fehlendeThemenImmer(werbeRegeln(prompt, aufruf), sprache)).toEqual([]);
  });
});

describe("Gegenprobe Stufe 1: die Prüfung wird rot, wenn das Verbot fehlt oder woanders steht", () => {
  test("ohne die zwei Sätze werden alle drei Themen gemeldet", () => {
    const ohne = de.singleLargePrompt
      .split("\n")
      .filter((zeile) => !/^- NIEMALS (pornografische|Waffen)/.test(zeile))
      .join("\n");
    expect(fehlendeThemenImmer(werbeRegeln(ohne, "Analyse-Aufruf"), "de")).toEqual([
      "Pornografie",
      "Waffen",
      "Extremismus",
    ]);
  });

  test("stehen die Sätze nur außerhalb der Werbe-Regeln, zählen sie im Analyse-Aufruf nicht", () => {
    const woanders =
      "═══ ANFANG ═══\n- NIEMALS Waffen, Munition oder extremistische Inhalte.\n═══ AD_TARGETING — X ═══\nad_targeting\n═══ ENDE ═══";
    expect(fehlendeThemenImmer(werbeRegeln(woanders, "Analyse-Aufruf"), "de")).toEqual([
      "Pornografie",
      "Waffen",
      "Extremismus",
    ]);
  });
});

describe("Gegenprobe: die Prüfung wird rot, wenn ein Thema fehlt", () => {
  test("ein Satz ohne Drogen und Tabak wird gemeldet", () => {
    const ohne =
      "- Bei Minderjährigen KEINE Angebote zu Alkohol, Glücksspiel, Kredit, Diät oder Schönheitskorrektur — ";
    expect(fehlendeThemen(ohne, "de")).toEqual(["Tabak", "Drogen"]);
  });

  test("ein Thema, das nur im Ersatz-Teil steht, zählt nicht", () => {
    const satz =
      "- Bei Minderjährigen KEINE Angebote zu Alkohol, Tabak, Glücksspiel, Kredit, Diät oder Schönheitskorrektur — stattdessen Aufklärung über Drogen.";
    const prompt = `Zeile davor\n${satz}\nZeile danach`;
    expect(fehlendeThemen(verbotsTeil(prompt, "de", VERBOTSSATZ.de.analyse), "de")).toEqual(["Drogen"]);
  });

  test("steht der Satz zweimal oder gar nicht im Prompt, gibt es keinen Verbots-Teil", () => {
    expect(verbotsTeil("kein Verbotssatz", "de", VERBOTSSATZ.de.analyse)).toBeNull();
    const zeile = `${VERBOTSSATZ.de.analyse}Alkohol — stattdessen Spiele.`;
    expect(verbotsTeil(`${zeile}\n${zeile}`, "de", VERBOTSSATZ.de.analyse)).toBeNull();
  });
});
