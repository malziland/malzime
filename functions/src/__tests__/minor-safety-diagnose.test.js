/**
 * Kinderschutz-Diagnose und Werbe-Anzahl (09.09.2026).
 *
 * Anlass: Am 08./09.09. meldete der Filter bei 8 von 19 Analysen mit
 * Minderjaehrigen einen Treffer im Fliesstext — das Log sagte aber nur
 * "minor", nicht welches Wort und in welchem Feld. Und ein Kind, bei dem
 * zwei Werbeeintraege gestrichen wurden, sah sechs Eintraege statt acht.
 *
 * Zwei Zusicherungen:
 *   1. Der Bericht traegt je Treffer Feld und das getroffene Stichwort aus
 *      der festen Sperrliste — und NUR das Stichwort, nie den Satz.
 *   2. Werbung wird nach dem Filter auf WERBE_ANZAHL gekappt; angefordert
 *      werden WERBE_ANFORDERUNG, damit die Anzahl auch nach dem Streichen
 *      stimmt. Trigger werden nicht gekappt.
 */
const { applyMinorSafety, WERBE_ANZAHL, WERBE_ANFORDERUNG } = require("../minor-safety");
const { loggeMinorSafety } = require("../job-helfer");

const KIND = "Du bist weiblich, ~14 Jahre alt (Spanne 12-16).";
const ERWACHSEN = "Du bist männlich, etwa 38. Spanne 35-42.";

function profil(alterText, ads, extra = {}) {
  const modus = () => ({
    categories: { alter_geschlecht: { value: alterText } },
    ad_targeting: [...ads],
    manipulation_triggers: [],
    profileText: "",
    ...extra,
  });
  return { normal: modus(), boost: modus() };
}

function zehnAds(...ersetzen) {
  const liste = ["Nike", "Adidas", "Spotify", "Netflix", "Zalando", "Apple", "Samsung", "Lego", "Disney+", "Puma"];
  ersetzen.forEach((e, i) => (liste[i] = e));
  return liste;
}

describe("Stichwort im Bericht", () => {
  test("entfernte Werbung traegt Feld und das getroffene Wort, klein geschrieben", () => {
    const b = applyMinorSafety(profil(KIND, ["Bet365 Live-Wetten Abo", "Nike"]));
    const treffer = b.entfernt.find((e) => e.modus === "boost");
    expect(treffer).toMatchObject({ feld: "ad_targeting", grund: "minor", stichwort: "bet365" });
  });
  test("harte Stufe liefert ebenfalls das Stichwort", () => {
    const b = applyMinorSafety(profil(ERWACHSEN, ["OnlyFans Merch Drops"]));
    expect(b.entfernt[0]).toMatchObject({ grund: "immer", stichwort: "onlyfans" });
  });
  test("Treffer im profileText nennt Feld und Stichwort, der Text bleibt", () => {
    const text = "Du gehst gern in Cocktail-Bars und bist leicht zu beeindrucken.";
    const b = applyMinorSafety(profil(KIND, ["Nike"], { profileText: text }));
    const d = b.durchgerutscht.find((x) => x.modus === "normal");
    expect(d).toEqual({ modus: "normal", feld: "profileText", grund: "minor", stichwort: "cocktail" });
    expect(b.durchgerutscht.length).toBe(2);
  });
  test("Treffer in einer Kategorie-Karte nennt den Kartennamen", () => {
    const p = profil(KIND, ["Nike"]);
    p.boost.categories.kaufkraft = { value: "Sportwetten-Apps würden dich sofort erreichen." };
    const b = applyMinorSafety(p);
    expect(b.durchgerutscht).toEqual([
      { modus: "boost", feld: "categories.kaufkraft", grund: "minor", stichwort: "sportwetten" },
    ]);
  });
  test("das Stichwort ist hoechstens 30 Zeichen lang und nie der ganze Satz", () => {
    const text = "x".repeat(40) + " buy now pay later " + "y".repeat(40);
    const b = applyMinorSafety(profil(KIND, [], { profileText: text }));
    expect(b.durchgerutscht[0].stichwort).toBe("buy now pay later");
    expect(b.durchgerutscht[0].stichwort.length).toBeLessThanOrEqual(30);
    expect(JSON.stringify(b.durchgerutscht)).not.toContain("xxxx");
  });
});

describe("Werbe-Anzahl", () => {
  test("angefordert werden zwei mehr, als gezeigt werden", () => {
    expect(WERBE_ANZAHL).toBe(8);
    expect(WERBE_ANFORDERUNG).toBe(WERBE_ANZAHL + 2);
  });
  test("beide Prompts fordern genau diese Zahl an", () => {
    const de = require("../locales/de/prompts").beastAdsSystem;
    const en = require("../locales/en/prompts").beastAdsSystem;
    expect(de).toContain(`Erzeuge genau ${WERBE_ANFORDERUNG} Werbeeinträge`);
    expect(en).toContain(`Generate exactly ${WERBE_ANFORDERUNG} ad entries`);
    expect(de).not.toMatch(/6-8/);
    expect(en).not.toMatch(/6-8/);
  });
  test("Erwachsener: zehn Eintraege werden auf acht gekappt, Reihenfolge bleibt", () => {
    const p = profil(ERWACHSEN, zehnAds());
    const b = applyMinorSafety(p);
    expect(p.boost.ad_targeting).toEqual(zehnAds().slice(0, 8));
    expect(b.werbung).toEqual({ normal: 8, boost: 8 });
    expect(b.gekappt).toHaveLength(2);
  });
  test("Kind mit zwei gestrichenen Eintraegen sieht trotzdem acht", () => {
    const p = profil(KIND, zehnAds("Bet365 Live-Wetten", "Klarna Ratenkauf"));
    const b = applyMinorSafety(p);
    expect(b.entfernt.filter((e) => e.modus === "boost")).toHaveLength(2);
    expect(p.boost.ad_targeting).toHaveLength(8);
    expect(p.boost.ad_targeting).not.toContain("Bet365 Live-Wetten");
    expect(b.werbung).toEqual({ normal: 8, boost: 8 });
  });
  test("Kind mit drei gestrichenen Eintraegen sieht sieben — nachgefuellt wird nichts", () => {
    const p = profil(KIND, zehnAds("Bet365", "Klarna Ratenkauf", "Aperol Spritz"));
    const b = applyMinorSafety(p);
    expect(p.boost.ad_targeting).toHaveLength(7);
    expect(b.werbung.boost).toBe(7);
  });
  test("weniger als acht bleiben unveraendert (Rueckfall aus dem Hauptaufruf)", () => {
    const p = profil(ERWACHSEN, ["Nike", "Adidas", "Spotify"]);
    const b = applyMinorSafety(p);
    expect(p.normal.ad_targeting).toEqual(["Nike", "Adidas", "Spotify"]);
    expect(b.gekappt).toEqual([]);
    expect(b.werbung).toEqual({ normal: 3, boost: 3 });
  });
  test("Manipulations-Trigger werden nicht gekappt", () => {
    const trigger = Array.from({ length: 10 }, (_, i) => `Erklaersatz ${i}`);
    const p = profil(ERWACHSEN, [], { manipulation_triggers: trigger });
    applyMinorSafety(p);
    expect(p.boost.manipulation_triggers).toHaveLength(10);
  });
});

describe("Log-Zeile minor-safety", () => {
  let ausgabe;
  beforeEach(() => {
    ausgabe = [];
    jest.spyOn(console, "log").mockImplementation((z) => ausgabe.push(z));
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test("traegt Stichwort, Feld und Werbe-Anzahl — aber nie den Werbetext", () => {
    const p = profil(KIND, zehnAds("Bet365 Live-Wetten Abo"), {
      profileText: "Cocktail-Abende mit Freundinnen.",
    });
    loggeMinorSafety(applyMinorSafety(p), "trace-1", "de");
    const zeile = JSON.parse(ausgabe.find((z) => z.includes('"minor-safety"')));
    expect(zeile.entfernte).toContainEqual({ feld: "boost.ad_targeting", grund: "minor", stichwort: "bet365" });
    expect(zeile.durchgerutschte).toContainEqual({ feld: "normal.profileText", grund: "minor", stichwort: "cocktail" });
    expect(zeile.werbung).toEqual({ normal: 8, boost: 8 });
    expect(zeile.gekappt).toBe(2);
    /* Die alten Zaehler bleiben, damit die gesicherte Zaehlung vom 08./09.09. vergleichbar bleibt. */
    expect(zeile.entfernt).toBe(2);
    expect(zeile.durchgerutscht).toBe(2);
    const roh = ausgabe.join("\n");
    expect(roh).not.toContain("Live-Wetten Abo");
    expect(roh).not.toContain("Freundinnen");
  });
  test("vertraegt einen leeren Bericht (kein Profil)", () => {
    loggeMinorSafety(applyMinorSafety(null), null, "de");
    const zeile = JSON.parse(ausgabe[0]);
    expect(zeile.werbung).toEqual({});
    expect(zeile.gekappt).toBe(0);
  });
});
