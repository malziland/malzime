"use strict";

const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

/* Nur db.js darf eine Firestore-Verbindung aufbauen (Audit 2026-08-10, PRIV-001).

   ANLASS: Die Datenschutzerklärung verspricht Europa, die ursprüngliche
   Datenbank liegt in `nam5` (USA). Der Standort ist unveränderlich; der Wechsel
   läuft über eine zweite Datenbank, ausgewählt durch EINEN Schalter
   (`FIRESTORE_DATABASE_ID` in config.js).

   Vor dem Umbau riefen vier Dateien an 22 Stellen direkt `getFirestore()` auf.
   Beim Umschalten hätte eine übersehene Stelle weiter in die alte Datenbank
   geschrieben — ohne Fehler, ohne Log, ohne dass es jemandem auffällt. Genau
   solche stillen Lücken sind der Grund, warum die Zusage „Daten in Europa"
   drei Audits lang unbemerkt falsch war.

   Diese Prüfung hält den Zustand fest: Wer den Import irgendwo sonst wieder
   einführt, macht sie rot. */

const SRC = join(__dirname, "..");
const ERLAUBT = "db.js";

/* Der Import ist der Engpass — ohne ihn kann niemand `getFirestore` aufrufen.
   Bewusst am Import geprüft und nicht am Aufruf: Aufruf-Schreibweisen tauchen
   auch in Kommentaren auf (config.js beschreibt die Regel im Fliesstext), der
   Import dagegen hat eine eindeutige Form. */
const IMPORT_DESTRUKTURIERT =
  /(?:const|let|var)\s*\{[^}]*\bgetFirestore\b[^}]*\}\s*=\s*require\(\s*["']firebase-admin\/firestore["']\s*\)/;
const IMPORT_DIREKT = /require\(\s*["']firebase-admin\/firestore["']\s*\)\s*\.\s*getFirestore/;

function quelldateien() {
  return readdirSync(SRC, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => e.name);
}

describe("Firestore-Zugriff läuft ausschliesslich über db.js", () => {
  const dateien = quelldateien();

  test("es wurden überhaupt Quelldateien gefunden (Positivkontrolle der Suche)", () => {
    expect(dateien.length).toBeGreaterThan(10);
    expect(dateien).toContain(ERLAUBT);
  });

  test("keine andere Datei importiert getFirestore", () => {
    const treffer = dateien
      .filter((name) => name !== ERLAUBT)
      .filter((name) => {
        const inhalt = readFileSync(join(SRC, name), "utf8");
        return IMPORT_DESTRUKTURIERT.test(inhalt) || IMPORT_DIREKT.test(inhalt);
      });
    expect(treffer).toEqual([]);
  });

  test("db.js importiert ihn sehr wohl (sonst prüfte der Test ins Leere)", () => {
    const inhalt = readFileSync(join(SRC, ERLAUBT), "utf8");
    expect(IMPORT_DESTRUKTURIERT.test(inhalt)).toBe(true);
  });

  test("der Erkenner findet beide Schreibweisen (Gegenprobe)", () => {
    expect(IMPORT_DESTRUKTURIERT.test('const { getFirestore } = require("firebase-admin/firestore");')).toBe(true);
    expect(
      IMPORT_DESTRUKTURIERT.test('const { getFirestore, FieldValue } = require("firebase-admin/firestore");')
    ).toBe(true);
    expect(IMPORT_DIREKT.test('require("firebase-admin/firestore").getFirestore()')).toBe(true);
    /* Und er schlägt NICHT bei einer blossen Erwähnung im Kommentar an — sonst
       wäre die Prüfung durch jeden erklärenden Text auslösbar. */
    expect(IMPORT_DESTRUKTURIERT.test("/* ein direkter getFirestore()-Aufruf waere falsch */")).toBe(false);
    expect(IMPORT_DIREKT.test("/* ein direkter getFirestore()-Aufruf waere falsch */")).toBe(false);
  });
});

describe("db.js wählt die Datenbank anhand des Schalters", () => {
  const ladeMitSchalter = (wert) => {
    jest.resetModules();
    const getFirestore = jest.fn(() => ({ markiert: true }));
    jest.doMock("firebase-admin/firestore", () => ({ getFirestore }));
    jest.doMock("../config", () => ({ FIRESTORE_DATABASE_ID: wert }));
    const modul = require("../db");
    return { modul, getFirestore };
  };

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test("leerer Schalter → getFirestore() OHNE Argument (Standard-Datenbank)", () => {
    const { modul, getFirestore } = ladeMitSchalter("");
    modul.datenbank();
    expect(getFirestore).toHaveBeenCalledTimes(1);
    /* Entscheidend: KEIN Argument. `getFirestore("")` ist kein gültiger Aufruf
       und würde zur Laufzeit scheitern. */
    expect(getFirestore).toHaveBeenCalledWith();
    expect(modul.aktiveDatenbank()).toBe("(default)");
  });

  test('Schalter "malzime-eu" → getFirestore("malzime-eu") (Datenbank in europe-west1)', () => {
    const { modul, getFirestore } = ladeMitSchalter("malzime-eu");
    modul.datenbank();
    expect(getFirestore).toHaveBeenCalledWith("malzime-eu");
    expect(modul.aktiveDatenbank()).toBe("malzime-eu");
  });
});

describe("Stellung des Schalters", () => {
  /* Am Quelltext geprüft, nicht am geladenen Modul: Im Test oben wird ../config
     gemockt, und `jest.doMock` bleibt für die restliche Datei wirksam — ein
     `require("../config")` hier bekäme den Mock und prüfte ins Leere. Der
     Quelltext ist ausserdem genau das, was ein Mensch beim Umschalten ändert. */
  test("steht derzeit auf der Standard-Datenbank", () => {
    const quelle = readFileSync(join(SRC, "config.js"), "utf8");
    const treffer = quelle.match(/^const FIRESTORE_DATABASE_ID = "([^"]*)";$/m);
    /* Kein zweites expect-Argument: Jest kennt die Meldungs-Variante nicht
       (das ist Vitest). Stattdessen eine eigene Zusicherung mit sprechendem
       Namen, damit ein Umbenennen der Konstante nicht als „Wert ist leer"
       durchgeht, sondern als fehlende Zeile auffällt. */
    expect(treffer === null ? "Zeile `const FIRESTORE_DATABASE_ID = …` fehlt in config.js" : "gefunden").toBe(
      "gefunden"
    );
    /* Nach dem Umzug wird diese Erwartung bewusst auf "malzime-eu" gezogen — der dann
       fehlschlagende Test ist die Erinnerung, RUNBOOK und CHANGELOG mitzuziehen. */
    expect(treffer[1]).toBe("");
  });
});
