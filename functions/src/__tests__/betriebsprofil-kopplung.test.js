"use strict";

/* Vier Kopplungsregeln der Satz-Pruefung (BUG-2026-10-03-33).

   Die Pruefung liess Werte durch, mit denen laufende und wartende Auftraege
   abgewuergt werden — jeder fuer sich im erlaubten Bereich, zusammen falsch:

     1. Das Haenge-Limit (verarbeitungsZeitlimitMs) unter der Zeitgrenze der
        Funktion: Die Statusabfrage setzt dann eine Analyse auf "gescheitert",
        waehrend der Verarbeiter noch rechnet; das fertige Ergebnis wird verworfen.
     2. Das Gesamtbudget so hoch, dass der Werbe-Aufruf danach die Zeitgrenze
        der Funktion reisst.
     3. Die Karenz fuer verlassene Auftraege (livenessGnadenfristMs) nicht klar
        ueber dem Nachlauf des Stundenzaehlers (60 s) und dem Mindestabstand des
        Lebenszeichens (30 s): Aktiv Wartende werden als verlassen abgeraeumt.
     4. Das Hoechstalter eines wartenden Auftrags ueber der Aufbewahrung: Der
        Auftrag wird geloescht, bevor er als ueberfaellig freigegeben wird.

   Grenzen, je mit einem Beispiel genau auf der Grenze (gilt) und eine
   Millisekunde daneben (abgelehnt). */

const { SATZ } = require("../test-satz");
const { PROFILE, T1_NORMAL } = require("../produktiv-satz");
const betriebsprofil = require("../betriebsprofil");
const { _pruefe } = betriebsprofil;
const fs = require("fs");
const path = require("path");

const FUNKTION_MS = 540 * 1000;
const STUNDE = 60 * 60 * 1000;

describe("Regel 1: Haenge-Limit nicht unter der Zeitgrenze der Funktion", () => {
  test("das Beispiel aus dem Befund: 60 Sekunden werden abgelehnt", () => {
    expect(_pruefe({ ...T1_NORMAL, verarbeitungsZeitlimitMs: 60000 })).toMatch(/verarbeitungsZeitlimitMs/);
  });

  test("genau die Zeitgrenze gilt, eine Millisekunde darunter nicht", () => {
    expect(_pruefe({ ...SATZ, verarbeitungsZeitlimitMs: FUNKTION_MS })).toBeNull();
    expect(_pruefe({ ...SATZ, verarbeitungsZeitlimitMs: FUNKTION_MS - 1 })).toMatch(
      /verarbeitungsZeitlimitMs \(539999 ms\).*Function-Limit/
    );
  });

  test("darueber gilt", () => {
    expect(_pruefe({ ...SATZ, verarbeitungsZeitlimitMs: 10 * 60 * 1000 })).toBeNull();
  });
});

describe("Regel 2: Budget plus Werbe-Aufruf plus Reserve passen in die Zeitgrenze der Funktion", () => {
  const hoechstens = FUNKTION_MS - betriebsprofil._WERBE_AUFRUF_HOECHSTENS_MS - betriebsprofil._RESERVE_NACH_ANALYSE_MS;

  test("die Grenze liegt bei 500 Sekunden", () => {
    expect(hoechstens).toBe(500 * 1000);
  });

  test("genau die Grenze gilt, eine Millisekunde darueber nicht", () => {
    expect(_pruefe({ ...SATZ, requestBudgetMs: hoechstens })).toBeNull();
    expect(_pruefe({ ...SATZ, requestBudgetMs: hoechstens + 1 })).toMatch(
      /requestBudgetMs \(500001 ms\).*Werbe-Aufruf/
    );
  });

  test("ein Budget genau auf der Zeitgrenze der Funktion wird abgelehnt", () => {
    expect(_pruefe({ ...SATZ, requestBudgetMs: FUNKTION_MS })).toMatch(/requestBudgetMs/);
  });

  test("die Dauer des Werbe-Aufrufs ist dieselbe wie in mistral.js", () => {
    const quelle = fs.readFileSync(path.join(__dirname, "..", "mistral.js"), "utf8");
    const aufruf = quelle.slice(quelle.indexOf("async function generateBeastAds("));
    const treffer = /timeoutMs:\s*([0-9_]+)/.exec(aufruf);
    expect(treffer).not.toBeNull();
    expect(Number(treffer[1].replace(/_/g, ""))).toBe(betriebsprofil._WERBE_AUFRUF_HOECHSTENS_MS);
  });
});

describe("Regel 3: Karenz klar ueber Zaehler-Nachlauf und Lebenszeichen-Abstand", () => {
  test("genau zwei Minuten gelten, eine Millisekunde darunter nicht", () => {
    expect(_pruefe({ ...SATZ, livenessGnadenfristMs: 120 * 1000 })).toBeNull();
    expect(_pruefe({ ...SATZ, livenessGnadenfristMs: 120 * 1000 - 1 })).toMatch(/livenessGnadenfristMs \(119999 ms\)/);
  });

  test("die fruehere Untergrenze von 30 Sekunden wird abgelehnt", () => {
    expect(_pruefe({ ...SATZ, livenessGnadenfristMs: 30 * 1000 })).toMatch(/livenessGnadenfristMs/);
  });

  test("die Grenze ist das Doppelte des Zaehler-Nachlaufs", () => {
    expect(betriebsprofil._KARENZ_MINDESTENS_MS).toBe(2 * require("../counter")._NACHLAUF_HOECHSTENS_MS);
  });
});

describe("Regel 4: Hoechstalter eines wartenden Auftrags hoechstens die Aufbewahrung", () => {
  test("gleich der Aufbewahrung gilt, eine Millisekunde darueber nicht", () => {
    expect(_pruefe({ ...SATZ, jobAufbewahrungMs: STUNDE, wartendesHoechstalterMs: STUNDE })).toBeNull();
    expect(_pruefe({ ...SATZ, jobAufbewahrungMs: STUNDE, wartendesHoechstalterMs: STUNDE + 1 })).toMatch(
      /wartendesHoechstalterMs \(3600001 ms\).*jobAufbewahrungMs \(3600000 ms\)/
    );
  });
});

describe("die ausgelieferten Saetze bestehen weiter", () => {
  test.each(Object.entries(PROFILE))("Satz %s", (_name, satz) => {
    expect(_pruefe(satz)).toBeNull();
  });

  test("der Testsatz", () => {
    expect(_pruefe(SATZ)).toBeNull();
  });
});
