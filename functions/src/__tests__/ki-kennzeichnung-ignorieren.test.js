/**
 * ki-kennzeichnung-ignorieren.test.js — Die eigene KI-Kennzeichnung darf die
 * Analyse nicht beeinflussen (BUG-2026-08-17-07).
 *
 * ANLASS: Der Prompt weist das Modell an, JEDEN sichtbaren Text aufzulisten,
 * ausdruecklich einschliesslich Bildunterschriften. Unsere drei Demo-Fotos
 * tragen die Pflichtkennzeichnung nach Artikel 50 der EU-KI-Verordnung in den
 * Bildpunkten — also genau so eine Bildunterschrift. Nichts im Prompt sagte
 * dem Modell, dass es sie uebergehen soll. Der sichtbare Text wandert in die
 * angereicherte Bildbeschreibung und damit in die Profilerstellung.
 *
 * Betroffen waeren genau die Bilder, die im Workshop am haeufigsten laufen.
 *
 * Zwei Riegel, hier beide geprueft: die Anweisung im Prompt (beide Sprachen)
 * und der Wasserzeichen-Filter in privacy.js als Netz, falls das Modell sie
 * trotzdem meldet.
 *
 * Reine Textanalyse — kein Netzwerk, keine Cloud.
 */

const { buildPrivacyRisks } = require("../privacy");
const de = require("../locales/de/prompts");
const en = require("../locales/en/prompts");

/** Alle Prompt-Texte einer Sprache als ein Suchraum. */
function alleTexte(mod) {
  return Object.values(mod)
    .filter((v) => typeof v === "string")
    .join("\n");
}

describe("Die eigene KI-Kennzeichnung beeinflusst die Analyse nicht", () => {
  test("der deutsche Prompt weist das Modell an, sie NICHT aufzulisten", () => {
    const t = alleTexte(de);
    expect(t).toMatch(/NICHT AUFLISTEN/);
    expect(t).toMatch(/KI ERSTELLT/);
    expect(t).toMatch(/AI GENERATED/);
  });

  test("der englische Prompt tut dasselbe", () => {
    const t = alleTexte(en);
    expect(t).toMatch(/DO NOT LIST/);
    expect(t).toMatch(/KI ERSTELLT/);
    expect(t).toMatch(/AI GENERATED/);
  });

  test("die Anweisung steht bei der Aufgabe zum sichtbaren Text, nicht irgendwo", () => {
    /* Sonst koennte sie im Prompt landen, ohne dort zu wirken, wo sie gebraucht
       wird — und der Test waere gruen fuer nichts. */
    const t = alleTexte(de);
    const anweisung = t.indexOf("NICHT AUFLISTEN");
    const aufgabe = t.indexOf("Sichtbarer Text:");
    expect(anweisung).toBeGreaterThan(-1);
    expect(aufgabe).toBeGreaterThan(-1);
    expect(Math.abs(anweisung - aufgabe)).toBeLessThan(600);
  });

  test.each([
    ["KI ERSTELLT", "de"],
    ["AI GENERATED", "en"],
    ["ki-generiert", "Kleinschreibung"],
  ])("meldet das Modell trotzdem %s, entsteht daraus KEIN Datenschutz-Risiko", (kennzeichnung) => {
    const risks = buildPrivacyRisks({
      visibleText: kennzeichnung,
      fullDescription: `Ein Foto vor einem Gebaeude. Sichtbarer Text: ${kennzeichnung}`,
    });
    expect(risks).toEqual([]);
  });

  test("POSITIVKONTROLLE: echte Risiken werden weiterhin erkannt", () => {
    /* Ohne diese Zeile waere der Test oben auch dann gruen, wenn
       buildPrivacyRisks gar nichts mehr faende. */
    expect(buildPrivacyRisks({ visibleText: "Hauptstraße 12", fullDescription: "" })).toContain("privacy.address");
    expect(buildPrivacyRisks({ visibleText: "0664 1234567", fullDescription: "" })).toContain("privacy.phone");
  });
});
