const fs = require("fs");
const path = require("path");
const { leseZdrPruefdatum, bewerteFrist, FRIST_TAGE } = require("../zusagen");

/**
 * Frische-Wächter für datierte Zusagen (Konzept „Richtung 100", 2026-08-12).
 *
 * Seit v3.0.5 nennt die Datenschutzerklärung ein Prüfdatum für die
 * EU-/Zero-Data-Retention-Zusage und verspricht öffentlich, spätestens
 * halbjährlich nachzuprüfen. Ein solches Versprechen ist nur so viel wert
 * wie seine Einhaltung — und niemand erinnert sich in sechs Monaten von
 * selbst daran.
 *
 * Zwei Schichten wachen darüber, beide über `../zusagen.js` (eine Frist,
 * eine Definition):
 *   - `handle-erinnerung.js` warnt eine Woche vorher per ntfy-Push aufs Handy.
 *   - DIESER Test ist die harte Bremse, falls die Vorwarnung untergeht.
 *
 * Auflösen des roten Baus (5 Minuten):
 *   1. Im Mistral-Dashboard nachsehen, ob Null-Datenspeicherung noch aktiv ist.
 *   2. Screenshot mit Datum in den privaten Nachweisordner legen.
 *   3. Das Datum in public/datenschutz.html an BEIDEN Stellen hochsetzen
 *      (Prüfdatum im Mistral-Absatz + Stand-Zeile im Kopf), Deploy.
 *
 * NIEMALS das Datum ohne echte Prüfung hochsetzen — dann behauptet die
 * Webseite etwas Unbelegtes, und genau das soll dieser Test verhindern.
 */

const WURZEL = path.join(__dirname, "../../..");
const SEITE = path.join(WURZEL, "public/datenschutz.html");

describe("Frische datierter Zusagen (Datenschutzerklärung)", () => {
  const inhalt = fs.readFileSync(SEITE, "utf8");

  test("das ZDR-Prüfdatum steht in der Seite und ist lesbar", () => {
    expect(leseZdrPruefdatum(inhalt)).not.toBeNull();
  });

  test("das ZDR-Prüfdatum ist nicht älter als das öffentliche Versprechen (halbjährlich)", () => {
    const stand = bewerteFrist(leseZdrPruefdatum(inhalt));
    if (stand.tageAlt > FRIST_TAGE) {
      throw new Error(
        `Das in der Datenschutzerklärung genannte Prüfdatum ist ${stand.tageAlt} Tage alt ` +
          `(erlaubt: ${FRIST_TAGE}). Die Seite verspricht öffentlich eine Prüfung ` +
          `mindestens halbjährlich.\n` +
          `→ Im Mistral-Dashboard nachsehen, ob Zero Data Retention noch aktiv ist, ` +
          `Screenshot in den Nachweisordner legen, DANN das Datum in ` +
          `public/datenschutz.html an beiden Stellen hochsetzen (Prüfdatum + Stand-Zeile).\n` +
          `Das Datum niemals ohne echte Prüfung ändern.`
      );
    }
    expect(stand.tageAlt).toBeLessThanOrEqual(FRIST_TAGE);
  });

  test("die Stand-Zeile im Kopf ist vorhanden und lesbar", () => {
    expect(inhalt).toMatch(/Stand: \d{1,2}\.(?:&nbsp;|\s)[A-Za-zÄÖÜäöü]+(?:&nbsp;|\s)\d{4}/);
  });
});
