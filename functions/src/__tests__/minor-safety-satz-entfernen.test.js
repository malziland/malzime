/**
 * Kinderschutz: ganzen Satz entfernen (09.11.2026, Entscheidung des Inhabers).
 *
 * Anlass: Am 09.11.2026 meldete der Filter drei Treffer der harten Liste
 * (Extremismus, Terror, Waffen, Pornografie) in Beast-Karten bei moeglicherweise
 * Minderjaehrigen — auch nach der Prompt-Regel aus 5.4.5. Die Messung mit 27
 * Kinderfotos traf keinen; das Wort ist live nicht nachstellbar. Deshalb:
 *   1. Bei moeglicherweise Minderjaehrigen faellt der ganze Satz mit dem Wort
 *      weg (Karte und Fazit), die Meldung bleibt.
 *   2. Bei Erwachsenen bleibt der Text wie bisher (nur Meldung).
 *   3. Bleibt nichts uebrig, faellt die Karte weg — nie eine leere Karte.
 *   4. Live waehrend der Analyse erscheint eine Karte mit dem Wort nicht, das
 *      Fazit nur bis vor den Treffer.
 */
const { applyMinorSafety, liveOhneHarteWoerter, _ohneHarteSaetze } = require("../minor-safety");

const KIND = "Du bist weiblich, ~12 Jahre alt (Spanne 10-14).";
const ERWACHSEN = "Du bist männlich, etwa 38. Spanne 35-42.";

function profil(alterText, extra = {}, karten = {}) {
  const modus = () => ({
    categories: { alter_geschlecht: { value: alterText }, ...JSON.parse(JSON.stringify(karten)) },
    ad_targeting: ["Nike"],
    manipulation_triggers: [],
    profileText: "",
    ...extra,
  });
  return { normal: modus(), boost: modus() };
}

describe("ganzer Satz faellt bei moeglicherweise Minderjaehrigen weg", () => {
  test("Karte: nur der Satz mit dem Wort geht, der Rest bleibt, Meldung bleibt", () => {
    const p = profil(
      KIND,
      {},
      {
        verletzlichkeit: { value: "Du suchst Anerkennung. Softair-Munition wäre ein Köder. Du vertraust schnell." },
      }
    );
    const b = applyMinorSafety(p);
    expect(p.boost.categories.verletzlichkeit.value).toBe("Du suchst Anerkennung. Du vertraust schnell.");
    expect(b.durchgerutscht.some((d) => d.feld === "categories.verletzlichkeit" && d.grund === "immer")).toBe(true);
    expect(b.satzEntfernt).toContainEqual({ modus: "boost", feld: "categories.verletzlichkeit" });
  });

  test("Fazit (profileText): Satz mit dem Wort faellt weg", () => {
    const p = profil(KIND, {
      profileText: "Du lachst gern. Werbung für OnlyFans würde dich treffen! Du bist neugierig.",
    });
    applyMinorSafety(p);
    expect(p.normal.profileText).toBe("Du lachst gern. Du bist neugierig.");
  });

  test("bleibt nichts uebrig, faellt die Karte weg — nie leer", () => {
    const p = profil(KIND, {}, { politisch: { value: "Extremistische Gruppen könnten dich ansprechen." } });
    applyMinorSafety(p);
    expect(p.normal.categories).not.toHaveProperty("politisch");
    expect(p.normal.categories.alter_geschlecht).toBeDefined();
  });

  test("Erwachsene: Text bleibt unveraendert, nur gemeldet", () => {
    const text = "Du suchst Anerkennung. Softair-Munition wäre ein Köder.";
    const p = profil(ERWACHSEN, {}, { verletzlichkeit: { value: text } });
    const b = applyMinorSafety(p);
    expect(p.normal.categories.verletzlichkeit.value).toBe(text);
    expect(b.satzEntfernt).toEqual([]);
    expect(b.durchgerutscht.length).toBeGreaterThan(0);
  });

  test("ohne Treffer bleibt der Text Zeichen fuer Zeichen gleich", () => {
    const text = "Du bist sportlich. „Gut so!“ Du lachst… oft.";
    expect(_ohneHarteSaetze(text)).toBe(text);
  });

  test("Bericht traegt nie Satz oder Wort im Feld satzEntfernt", () => {
    const p = profil(KIND, {}, { verletzlichkeit: { value: "Munition reizt dich. Du bist ruhig." } });
    const b = applyMinorSafety(p);
    expect(JSON.stringify(b.satzEntfernt)).not.toMatch(/munition|ruhig/i);
  });
});

/* Befund der unabhaengigen Pruefung (09.11.2026): Die erste Satzteilung trennte
   an jedem Punkt — "eis.de" fiel auseinander und wurde live nicht erkannt;
   "z. B." und "3.5" hinterliessen unsinnige Reste. */
describe("Satzgrenzen", () => {
  test("Wort mit Punkt (eis.de) wird erkannt, live und am Ende", () => {
    const text = "Du liest gern. Bestell doch bei eis.de etwas. Du bist nett.";
    expect(_ohneHarteSaetze(text)).toBe("Du liest gern. Du bist nett.");
    expect(liveOhneHarteWoerter({ standard: text, beast: null, kartenStandard: [], kartenBeast: [] }).standard).toBe(
      "Du liest gern."
    );
  });
  test("Abkuerzung und Zahl bleiben im Satz, der ganze Satz faellt", () => {
    expect(_ohneHarteSaetze("Du bist neugierig. Du kaufst z. B. bei OnlyFans ein. Du lachst.")).toBe(
      "Du bist neugierig. Du lachst."
    );
    expect(_ohneHarteSaetze("Du lachst. Ca. 3.5 Std. am Tag schaust du Pornos. Du schläfst.")).toBe(
      "Du lachst. Du schläfst."
    );
  });
  test("Satzende mit Anfuehrungszeichen und Ausrufezeichen", () => {
    expect(_ohneHarteSaetze("„Los!“ Munition reizt dich! Du bist ruhig.")).toBe("„Los!“ Du bist ruhig.");
  });
});

describe("Alter nicht lesbar zaehlt als moeglicherweise minderjaehrig", () => {
  test("ohne lesbares Alter faellt der Satz ebenfalls", () => {
    const p = profil(
      "Alter: schwer zu sagen.",
      {},
      {
        verletzlichkeit: { value: "Du suchst Halt. Munition wäre ein Köder." },
      }
    );
    /* So meldet der Analyseweg ein nicht lesbares Alter (job-pipelines.js). */
    const b = applyMinorSafety(p, { alterUnlesbar: true });
    expect(b.minderjaehrig).toBe(true);
    expect(p.normal.categories.verletzlichkeit.value).toBe("Du suchst Halt.");
  });
});

describe("Live-Anzeige waehrend der Analyse", () => {
  test("Karte mit dem Wort erscheint nicht, Fazit nur bis vor den Treffer", () => {
    const live = liveOhneHarteWoerter({
      standard: "Du lachst gern. Pornhub-Werbung würde dich treffen. Du bist neugierig.",
      beast: null,
      kartenStandard: [
        { schluessel: "hobbys", bezeichnung: "Hobbys", wert: "Fußball." },
        { schluessel: "verletzlichkeit", bezeichnung: "V", wert: "Munition reizt dich." },
      ],
      kartenBeast: [],
    });
    expect(live.standard).toBe("Du lachst gern.");
    expect(live.kartenStandard.map((k) => k.schluessel)).toEqual(["hobbys"]);
    expect(live.beast).toBeNull();
  });

  test("ohne Treffer bleibt der Live-Stand unveraendert", () => {
    const live = { standard: "Du lachst.", beast: "Du kaufst.", kartenStandard: [], kartenBeast: [] };
    expect(liveOhneHarteWoerter(live)).toEqual(live);
  });
});
