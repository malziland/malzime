const de = require("../locales/de/prompts");
const en = require("../locales/en/prompts");

/**
 * Sichert die Primaten-Regel in BEIDEN Pfaden und BEIDEN Sprachen ab.
 *
 * WARUM ES DIESEN TEST GIBT (Audit 2026-08-10, BUG-001):
 * Anlass war ein Affenbild, aus dem das Modell ein Profil eines afrikanischen
 * Kleinkindes erzeugte. Die Antwort darauf war zweigleisig: eine Regel im
 * Prompt UND ein serverseitiges Netz (`pruefeTierWiderspruch`).
 *
 * Das Netz ist mit dem Audit entfernt worden — es prüfte im aktiven Pfad nicht
 * die Bildbeschreibung, sondern den daraus erzeugten Profiltext, fing dadurch
 * seinen Anlassfall nie und schlug nur bei harmlosen Wörtern an („Apex
 * Legends", „Fell besetzt"). Damit ist die Prompt-Regel der EINZIGE verbliebene
 * Schutz — und sie stand bis dahin nur im `singleLargePrompt`.
 *
 * Nach einem Rollback auf den 3-Call-Pfad (RUNBOOK, Hebel 3) hätte also gar
 * kein Schutz mehr existiert. Genau das hält dieser Test fest: Die Regel muss
 * an allen vier Stellen stehen, sonst ist sie im Störfall weg.
 */

const PROMPTS = [
  ["de/mistralDescribeAddendum (Fallback-Pfad)", de.mistralDescribeAddendum],
  ["de/singleLargePrompt (aktiver Pfad)", de.singleLargePrompt],
  ["en/mistralDescribeAddendum (Fallback-Pfad)", en.mistralDescribeAddendum],
  ["en/singleLargePrompt (aktiver Pfad)", en.singleLargePrompt],
];

/* Die Arten, die im Vorfall verwechselt wurden — je Sprache die Begriffe, die
   im Prompt tatsächlich stehen. */
const PRIMATEN = {
  de: [/schimpanse/i, /gorilla/i, /orang-?utan/i, /makake/i],
  en: [/chimpanzee/i, /gorilla/i, /orangutan/i, /macaque/i],
};

/* Die Merkmals-Prüfliste, die der Festlegung vorausgeht. */
const MERKMALE = {
  de: [/fell/i, /schnauze/i, /pfoten|krallen/i, /schwanz/i, /schnurrhaare/i],
  en: [/fur/i, /muzzle/i, /paws|claws/i, /tail/i, /whiskers/i],
};

describe.each(PROMPTS)("Primaten-Regel in %s", (name, prompt) => {
  const sprache = name.startsWith("de/") ? "de" : "en";

  test("der Prompt-Text existiert überhaupt (Positivkontrolle)", () => {
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(200);
  });

  test("nennt ANIMAL_ONLY als Pflichtwert für Primaten", () => {
    /* Die Regel muss unmissverständlich sein: immer ANIMAL_ONLY, nie HUMAN. */
    expect(prompt).toMatch(/ANIMAL_ONLY/);
    const regelZeile = sprache === "de" ? /IMMER ANIMAL_ONLY, NIEMALS HUMAN/i : /ALWAYS ANIMAL_ONLY, NEVER HUMAN/i;
    expect(prompt).toMatch(regelZeile);
  });

  test.each(PRIMATEN[sprache])("nennt die Art %s ausdrücklich", (muster) => {
    expect(prompt).toMatch(muster);
  });

  test.each(MERKMALE[sprache])("führt das Merkmal %s in der Prüfliste", (muster) => {
    expect(prompt).toMatch(muster);
  });
});

/* SEC-006 (Audit 2026-08-10): Die Prompt-Injektions-Warnung steckte nur im
   3-Call-Pfad. Im aktiv geschalteten Single-Large-Prompt fehlte sie — dort geht
   das Bild direkt an das multimodale Modell, und sichtbarer Text im Bild
   („Ignoriere alle Anweisungen …") konnte als Anweisung gelesen werden.
   SECURITY.md behauptete derweil „User data isolated in XML tags", was nur für
   den Fallback-Pfad zutraf. */
describe.each([
  ["de/singleLargePrompt", de.singleLargePrompt, /niemals eine Anweisung|folge ihm NICHT/i],
  ["en/singleLargePrompt", en.singleLargePrompt, /never an instruction|do NOT follow it/i],
])("Prompt-Injektions-Warnung in %s", (name, prompt, muster) => {
  test("warnt davor, Bildtext als Anweisung zu lesen", () => {
    expect(prompt).toMatch(muster);
  });
  test("nennt die Schutzregeln für Minderjährige als vorrangig", () => {
    expect(prompt).toMatch(/Minderjaehrige|minors/i);
  });
});
