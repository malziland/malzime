/**
 * ausgemustert-uebergang.test.js — der Uebergang beim Ausbau eines Wertes.
 *
 * ANLASS (10.09.2026, Ausbau des Drei-Aufruf-Wegs): Der neue Code kennt
 * einige Felder des Einstellungssatzes nicht mehr, der BISHER laufende Code
 * liest sie aber als Pflichtfelder. In der Datenbank muessen sie deshalb bis
 * nach dem Ausliefern stehen bleiben. Der Abgleich vor dem Deploy
 * (scripts/betriebsprofil-vergleichen.js) duldet genau diese Reste bis zu
 * einem Stichtag — siehe AUSGEMUSTERT in produktiv-satz.js.
 *
 * Geprueft wird dreierlei: dass der Uebergang befristet ist, dass er nur das
 * duldet, was ausdruecklich genannt ist, und dass er nach dem Stichtag endet.
 */

const { PROFILE, AKTIV, AUSGEMUSTERT } = require("../produktiv-satz");
const { PFLICHTFELDER } = require("../betriebsprofil");
const { abweichungen, geduldeteReste } = require("../../../scripts/betriebsprofil-vergleichen");

/* Eine Datenbank, die dem Repo genau entspricht. */
function wieImRepo() {
  const profile = {};
  for (const [name, satz] of Object.entries(PROFILE)) profile[name] = { ...satz };
  return { aktiv: AKTIV, profile };
}

/* Eine Probe-Liste, damit die Mechanik auch dann geprueft bleibt, wenn
   AUSGEMUSTERT nach dem Aufraeumen leer ist. */
const PROBE = { bis: "2030-01-01", felder: ["altesFeld"], saetze: ["alter-satz"] };
const VORHER = new Date("2029-12-31T12:00:00Z");
const NACHHER = new Date("2030-01-02T12:00:00Z");

function mitResten() {
  const daten = wieImRepo();
  daten.profile[AKTIV].altesFeld = 1;
  daten.profile["alter-satz"] = { ...daten.profile[AKTIV] };
  return daten;
}

describe("AUSGEMUSTERT in produktiv-satz.js", () => {
  const offen = AUSGEMUSTERT.felder.length + AUSGEMUSTERT.saetze.length;

  test("ist befristet — und die Frist ist nicht abgelaufen, solange noch etwas darin steht", () => {
    expect(AUSGEMUSTERT.bis).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (offen > 0) {
      /* Wird dieser Test rot: Nach dem Deploy den Satz mit
         `node scripts/betriebsprofil-anlegen.js --ausfuehren --ueberschreiben`
         neu schreiben und die Listen in AUSGEMUSTERT leeren. */
      expect(new Date().toISOString().slice(0, 10) <= AUSGEMUSTERT.bis).toBe(true);
    }
  });

  test("nennt nur, was der Code wirklich nicht mehr kennt", () => {
    for (const feld of AUSGEMUSTERT.felder) {
      expect(PFLICHTFELDER).not.toContain(feld);
      for (const satz of Object.values(PROFILE)) expect(satz).not.toHaveProperty(feld);
    }
    for (const name of AUSGEMUSTERT.saetze) expect(PROFILE).not.toHaveProperty(name);
  });
});

describe("Abgleich vor dem Deploy", () => {
  test("Datenbank wie im Repo: keine Abweichung, keine Reste", () => {
    expect(abweichungen(wieImRepo(), VORHER, PROBE)).toEqual([]);
    expect(geduldeteReste(wieImRepo(), VORHER, PROBE)).toEqual([]);
  });

  test("genannte Reste werden vor dem Stichtag geduldet — und sichtbar gemeldet", () => {
    expect(abweichungen(mitResten(), VORHER, PROBE)).toEqual([]);
    expect(geduldeteReste(mitResten(), VORHER, PROBE)).toEqual([`${AKTIV}.altesFeld`, "alter-satz (ganzer Satz)"]);
  });

  test("ein NICHT genannter Rest bleibt eine Abweichung", () => {
    /* Positivkontrolle: Die Duldung darf den Abgleich nicht blind machen. */
    const daten = mitResten();
    daten.profile[AKTIV].unbekanntesFeld = 7;
    expect(abweichungen(daten, VORHER, PROBE)).toEqual([`${AKTIV}.unbekanntesFeld: nur in der Datenbank (DB=7)`]);
  });

  test("nach dem Stichtag gelten die Reste wieder als Abweichung", () => {
    const liste = abweichungen(mitResten(), NACHHER, PROBE);
    expect(liste).toContain(`${AKTIV}.altesFeld: nur in der Datenbank (DB=1)`);
    expect(liste).toContain("alter-satz: nur in der Datenbank");
    expect(geduldeteReste(mitResten(), NACHHER, PROBE)).toEqual([]);
  });

  test("ein abweichender WERT wird nie geduldet, auch nicht bei einem genannten Feld", () => {
    const daten = wieImRepo();
    daten.profile[AKTIV].parallelitaet = PROFILE[AKTIV].parallelitaet + 1;
    expect(abweichungen(daten, VORHER, { ...PROBE, felder: ["parallelitaet"] }).length).toBe(1);
  });
});
