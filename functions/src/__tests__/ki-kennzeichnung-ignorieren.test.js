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

/* Geprueft wird der ANALYSE-PROMPT, nicht alle Prompt-Texte zusammen.

   BEFUND 10.09.2026 (Ausbau des Drei-Aufruf-Wegs): Die Anweisung stand bis
   dahin nur im Beschreibungs-Baustein des ausgebauten Wegs. Dieser Test
   durchsuchte alle Texte einer Sprache, fand sie dort und war gruen — obwohl
   der Analyse-Prompt, der jedes Bild tatsaechlich sieht, sie nie enthielt.
   Seither steht sie bei der Aufgabe `visible_text` im singleLargePrompt. */
const ANALYSE = [
  ["de", de.singleLargePrompt, "NICHT AUFLISTEN"],
  ["en", en.singleLargePrompt, "DO NOT LIST"],
];

describe("Die eigene KI-Kennzeichnung beeinflusst die Analyse nicht", () => {
  test.each(ANALYSE)("der Analyse-Prompt (%s) weist das Modell an, sie NICHT aufzulisten", (_l, prompt, wort) => {
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain(wort);
    expect(prompt).toMatch(/KI ERSTELLT/);
    expect(prompt).toMatch(/AI GENERATED/);
  });

  test.each(ANALYSE)("die Anweisung steht bei der Aufgabe visible_text (%s), nicht irgendwo", (_l, prompt, wort) => {
    /* Sonst koennte sie im Prompt landen, ohne dort zu wirken, wo sie gebraucht
       wird — und der Test waere gruen fuer nichts. */
    const aufgabe = prompt.indexOf("- visible_text:");
    const anweisung = prompt.indexOf(wort);
    expect(aufgabe).toBeGreaterThan(-1);
    expect(anweisung).toBeGreaterThan(aufgabe);
    expect(anweisung - aufgabe).toBeLessThan(900);
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
