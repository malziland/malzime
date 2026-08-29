/**
 * mistral-livekarten.test.js — Fertige Kategorie-Karten aus dem laufenden Strom.
 *
 * HINTERGRUND (FEATURE-2026-08-29-01): Ein Profil besteht aus `profileText` UND
 * 13 Karten, und der Prompt verlangt den Text ZUERST. Bis hierher wanderte nur
 * der Text in die Live-Anzeige — die Karten entstanden unsichtbar. Gemessen am
 * 28.08.2026: Standard-Text nach 34,6 s fertig, Beast-Text ab ~85 s. Dazwischen
 * 50 Sekunden, in denen der Bildschirm stillsteht, obwohl dort die halbe Arbeit
 * passiert. Der Nutzer hielt das fuer das Ende.
 *
 * Die Pruefung deckt vor allem die Grenzfaelle ab: Eine halb angekommene Karte
 * darf NICHT erscheinen — sie wuerde sich beim naechsten Poll veraendern und
 * saehe wie ein Fehler aus.
 *
 * Reine Zeichenketten-Pruefung — kein Netzwerk, keine Cloud.
 */

const { _extrahiereLiveText } = require("../mistral");

/* Aufbau wie im echten Schema: label VOR value, dann confidence. */
function baueAntwort() {
  return JSON.stringify({
    subject: "HUMAN",
    standard: {
      profileText: "Du bist ein Mann Anfang dreissig.",
      categories: {
        alter_geschlecht: { label: "Alter & Geschlecht", value: "Maennlich, etwa 32", confidence: 0.8 },
        herkunft: { label: "Herkunft", value: "Mitteleuropa", confidence: 0.7 },
      },
    },
    beast: {
      profileText: "Wir wissen, dass du wanderst.",
      categories: {
        alter_geschlecht: {
          label: "Alter & Geschlecht",
          value: "Anfang dreissig, zynisch betrachtet",
          confidence: 0.8,
        },
      },
    },
  });
}

describe("Kategorie-Karten im Live-Strom", () => {
  test("fertige Karten werden je Profil getrennt herausgegeben", () => {
    const { kartenStandard, kartenBeast } = _extrahiereLiveText(baueAntwort());

    expect(kartenStandard.map((k) => k.schluessel)).toEqual(["alter_geschlecht", "herkunft"]);
    expect(kartenStandard[0].bezeichnung).toBe("Alter & Geschlecht");
    expect(kartenStandard[0].wert).toBe("Maennlich, etwa 32");
    /* Die Beast-Karte traegt denselben Schluessel, aber einen anderen Wert —
       ohne saubere Trennung wuerde hier der Standard-Wert doppelt erscheinen. */
    expect(kartenBeast).toHaveLength(1);
    expect(kartenBeast[0].wert).toBe("Anfang dreissig, zynisch betrachtet");
  });

  test("eine halb angekommene Karte erscheint nicht", () => {
    const voll = baueAntwort();
    /* Mitten im Wert der zweiten Karte abschneiden. */
    const bis = voll.indexOf("Mitteleuropa") + 5;
    const { kartenStandard } = _extrahiereLiveText(voll.slice(0, bis));

    expect(kartenStandard.map((k) => k.schluessel)).toEqual(["alter_geschlecht"]);
  });

  test("eine Karte ohne fertige Bezeichnung erscheint nicht", () => {
    const voll = baueAntwort();
    /* Direkt hinter dem Kartenschluessel abschneiden: Das Label hat begonnen,
       ist aber nicht komplett — ohne Beschriftung waere die Zeile nutzlos. */
    const bis = voll.indexOf('"label":"Alter') + 12;
    const { kartenStandard } = _extrahiereLiveText(voll.slice(0, bis));

    expect(kartenStandard).toEqual([]);
  });

  test("ohne categories bleibt alles wie bisher", () => {
    const nurText = JSON.stringify({ standard: { profileText: "Du bist." } });
    const ergebnis = _extrahiereLiveText(nurText);

    expect(ergebnis.standard).toBe("Du bist.");
    expect(ergebnis.kartenStandard).toEqual([]);
    expect(ergebnis.kartenBeast).toEqual([]);
  });

  test("der Textpfad bleibt unveraendert", () => {
    /* Regressionsschutz: Die beiden bestehenden Felder sind der aeltere,
       ausgelieferte Weg — an ihnen darf die Erweiterung nichts aendern. */
    const { standard, beast } = _extrahiereLiveText(baueAntwort());

    expect(standard).toBe("Du bist ein Mann Anfang dreissig.");
    expect(beast).toBe("Wir wissen, dass du wanderst.");
  });
});
