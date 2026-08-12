const fs = require("fs");
const path = require("path");

/**
 * Frische-Wächter für datierte Zusagen (Konzept „Richtung 100", 2026-08-12).
 *
 * Seit v3.0.5 nennt die Datenschutzerklärung ein Prüfdatum für die
 * EU-/Zero-Data-Retention-Zusage und verspricht öffentlich, „spätestens
 * halbjährlich" nachzuprüfen. Ein solches Versprechen ist nur so viel wert
 * wie seine Einhaltung — und niemand erinnert sich in sechs Monaten von
 * selbst daran.
 *
 * Darum wacht die CI darüber: Wird das Prüfdatum zu alt, färbt sich der Bau
 * rot und nennt im Klartext, was zu tun ist. Das ist derselbe Gedanke wie
 * beim Infrastruktur-Prüfskript — eine Zusage bekommt einen Wächter, keine
 * Erinnerungsnotiz.
 *
 * Auflösen des roten Baus (5 Minuten):
 *   1. Im Mistral-Dashboard nachsehen, ob „Null-Datenspeicherung" noch aktiv
 *      ist (admin.mistral.ai → Datenschutz).
 *   2. Screenshot mit Datum in den privaten Nachweisordner legen.
 *   3. Das Datum in public/datenschutz.html an BEIDEN Stellen hochsetzen
 *      (Prüfdatum im Mistral-Absatz + „Stand:"-Zeile im Kopf), Deploy.
 *
 * NIEMALS das Datum ohne echte Prüfung hochsetzen — dann behauptet die
 * Webseite etwas Unbelegtes, und genau das soll dieser Test verhindern.
 */

const WURZEL = path.join(__dirname, "../../..");
const SEITE = path.join(WURZEL, "public/datenschutz.html");

/* Öffentliches Versprechen: „spätestens halbjährlich". */
const FRIST_TAGE = 183;

const MONATE = {
  Januar: 0,
  Februar: 1,
  März: 2,
  April: 3,
  Mai: 4,
  Juni: 5,
  Juli: 6,
  August: 7,
  September: 8,
  Oktober: 9,
  November: 10,
  Dezember: 11,
};

/** Liest „11.&nbsp;August&nbsp;2026" (auch mit normalen Leerzeichen) als Datum. */
function leseDeutschesDatum(text, muster) {
  const treffer = text.match(muster);
  if (!treffer) return null;
  const [, tag, monat, jahr] = treffer;
  const monatIndex = MONATE[monat];
  if (monatIndex === undefined) return null;
  return new Date(Number(jahr), monatIndex, Number(tag));
}

function tageSeit(datum) {
  return Math.floor((Date.now() - datum.getTime()) / 86400000);
}

describe("Frische datierter Zusagen (Datenschutzerklärung)", () => {
  const inhalt = fs.readFileSync(SEITE, "utf8");

  test("das ZDR-Prüfdatum steht in der Seite und ist lesbar", () => {
    const datum = leseDeutschesDatum(
      inhalt,
      /zuletzt am (\d{1,2})\.(?:&nbsp;|\s)([A-Za-zÄÖÜäöü]+)(?:&nbsp;|\s)(\d{4})/
    );
    expect(datum).not.toBeNull();
  });

  test("das ZDR-Prüfdatum ist nicht älter als das öffentliche Versprechen (halbjährlich)", () => {
    const datum = leseDeutschesDatum(
      inhalt,
      /zuletzt am (\d{1,2})\.(?:&nbsp;|\s)([A-Za-zÄÖÜäöü]+)(?:&nbsp;|\s)(\d{4})/
    );
    const alter = tageSeit(datum);
    if (alter > FRIST_TAGE) {
      throw new Error(
        `Das in der Datenschutzerklärung genannte Prüfdatum ist ${alter} Tage alt ` +
          `(erlaubt: ${FRIST_TAGE}). Die Seite verspricht öffentlich eine Prüfung ` +
          `mindestens halbjährlich.\n` +
          `→ Im Mistral-Dashboard nachsehen, ob Zero Data Retention noch aktiv ist, ` +
          `Screenshot in den Nachweisordner legen, DANN das Datum in ` +
          `public/datenschutz.html an beiden Stellen hochsetzen (Prüfdatum + „Stand:").\n` +
          `Das Datum niemals ohne echte Prüfung ändern.`
      );
    }
    expect(alter).toBeLessThanOrEqual(FRIST_TAGE);
  });

  test("die Stand-Zeile im Kopf ist vorhanden und lesbar", () => {
    const datum = leseDeutschesDatum(inhalt, /Stand: (\d{1,2})\.(?:&nbsp;|\s)([A-Za-zÄÖÜäöü]+)(?:&nbsp;|\s)(\d{4})/);
    expect(datum).not.toBeNull();
  });
});
