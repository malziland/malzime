const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { leseZdrPruefdatum, FRIST_TAGE } = require("../zusagen");

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
 *   - `scripts/pruefe-zusagen-frist.mjs` ist die harte Bremse im Pipeline-Job
 *     `datumspruefungen`, falls die Vorwarnung untergeht.
 *
 * Bis 17.10.2026 war die Bremse selbst ein Test dieser Datei und verglich die
 * ECHTE Uhr mit dem Datum der Seite. Damit hing die ganze Server-Suite an der
 * Uhr, und die Auslieferung durfte ihr Ergebnis nie aus dem Pull Request
 * übernehmen. Diese Datei prüft jetzt nur noch, was vom Inhalt abhängt: dass
 * die Seite die Daten lesbar trägt, und dass die Bremse am festgelegten Tag
 * anschlägt — mit vorgegebener Uhr, damit das Ergebnis an jedem Tag dasselbe
 * ist. Ob die Frist HEUTE eingehalten ist, misst der Job `datumspruefungen`.
 */

const WURZEL = path.join(__dirname, "../../..");
const SEITE = path.join(WURZEL, "public/datenschutz.html");
const SKRIPT = path.join(WURZEL, "scripts/pruefe-zusagen-frist.mjs");

/** Führt die Bremse aus; gibt Rückgabewert und Ausgabe zurück. */
function bremse(...argumente) {
  try {
    const ausgabe = execFileSync("node", [SKRIPT, ...argumente], { encoding: "utf8", stdio: "pipe" });
    return { code: 0, ausgabe };
  } catch (e) {
    return { code: e.status, ausgabe: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

/** Mittag des Tages, der `tage` Tage nach `datum` liegt — als Millisekunden.
 *  Mittag statt Mitternacht: Eine Zeitumstellung dazwischen verschiebt um eine
 *  Stunde und kippt so nie den gezählten Tag. */
function mittagNach(datum, tage) {
  return new Date(datum.getFullYear(), datum.getMonth(), datum.getDate() + tage, 12).getTime();
}

describe("Frische datierter Zusagen (Datenschutzerklärung)", () => {
  const inhalt = fs.readFileSync(SEITE, "utf8");

  test("das ZDR-Prüfdatum steht in der Seite und ist lesbar", () => {
    expect(leseZdrPruefdatum(inhalt)).not.toBeNull();
  });

  test("die Stand-Zeile im Kopf ist vorhanden und lesbar", () => {
    expect(inhalt).toMatch(/Stand: \d{1,2}\.(?:&nbsp;|\s)[A-Za-zÄÖÜäöü]+(?:&nbsp;|\s)\d{4}/);
  });
});

describe("Die Bremse scripts/pruefe-zusagen-frist.mjs — mit vorgegebener Uhr", () => {
  const datum = leseZdrPruefdatum(fs.readFileSync(SEITE, "utf8"));
  let leer;

  beforeAll(() => {
    leer = fs.mkdtempSync(path.join(os.tmpdir(), "malzime-zusagen-frist-"));
  });
  afterAll(() => {
    if (leer) fs.rmSync(leer, { recursive: true, force: true });
  });

  test("am letzten erlaubten Tag (genau die Frist alt): grün", () => {
    const r = bremse(WURZEL, "--jetzt", String(mittagNach(datum, FRIST_TAGE)));
    expect(r.ausgabe).toContain(`ist ${FRIST_TAGE} Tage alt (erlaubt: ${FRIST_TAGE}, noch 0 Tage)`);
    expect(r.code).toBe(0);
  });

  test("einen Tag später: rot, mit der Handlungsanleitung", () => {
    const r = bremse(WURZEL, "--jetzt", String(mittagNach(datum, FRIST_TAGE + 1)));
    expect(r.code).toBe(1);
    expect(r.ausgabe).toContain(`ist ${FRIST_TAGE + 1} Tage alt (erlaubt: ${FRIST_TAGE})`);
    expect(r.ausgabe).toMatch(/Mistral-Dashboard/);
    expect(r.ausgabe).toMatch(/niemals ohne echte Pruefung/);
  });

  test("die vorgegebene Uhr wird laut genannt — so laufen nur diese Tests", () => {
    const r = bremse(WURZEL, "--jetzt", String(mittagNach(datum, 1)));
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/HINWEIS: Uhr vorgegeben/);
  });

  test("Seite ohne lesbares Prüfdatum: nicht messbar (2), nie grün", () => {
    fs.mkdirSync(path.join(leer, "public"), { recursive: true });
    fs.writeFileSync(path.join(leer, "public/datenschutz.html"), "<p>Diese Zusagen pruefen wir regelmaessig.</p>");
    const r = bremse(leer, "--jetzt", String(mittagNach(datum, 1)));
    expect(r.code).toBe(2);
    expect(r.ausgabe).toMatch(/NICHT MESSBAR: Das ZDR-Pruefdatum steht nicht lesbar/);
  });

  test("Seite fehlt: nicht messbar (2), nie grün", () => {
    const r = bremse(path.join(leer, "gibt-es-nicht"), "--jetzt", String(mittagNach(datum, 1)));
    expect(r.code).toBe(2);
    expect(r.ausgabe).toMatch(/NICHT MESSBAR: .*datenschutz\.html ist nicht lesbar/);
  });

  test("--jetzt ohne Zahl: nicht messbar (2), statt still mit der echten Uhr zu rechnen", () => {
    const r = bremse(WURZEL, "--jetzt", "gestern");
    expect(r.code).toBe(2);
    expect(r.ausgabe).toMatch(/--jetzt verlangt eine Zahl/);
  });
});
