"use strict";

/* PRIV-2026-09-10-01 (Ursache), Gegenstueck zu
   public/__tests__/datenschutz-deckung.test.js.

   Die Deckungspruefung dort vergleicht die exportierte `_freigabeliste` mit dem
   Datenschutztext. Sie waere blind, wenn ein Handler ein Feld uebernimmt, das
   NICHT in dieser Liste steht — etwa aus einer neuen Konstante, die niemand in
   den Export aufnimmt. Dieser Test schliesst die Luecke am Verhalten: Er ruft
   den echten Handler mit einem Rumpf auf, der jeden Lesezugriff mitschreibt.
   Was der Handler liest, kann er uebernehmen, und muss deshalb in der Liste
   stehen. Umgekehrt muss jeder Listeneintrag auch gelesen werden, sonst
   beschreibt die Liste etwas, das es nicht gibt.

   Der Realitaets-Check-Weg der Telemetrie hat seine eigene, strenge Pruefung
   (handle-telemetry-realitaets-check.test.js): Er verwirft jeden Rumpf, der
   andere als die festen Stufen enthaelt. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../counter");
jest.mock("../jobs");

const { handleErrors, _freigabeliste: LISTE_ERRORS } = require("../handle-errors");
const { handleTelemetry, _freigabeliste: LISTE_TELEMETRIE } = require("../handle-telemetry");

/* Ein Rumpf, der jeden gelesenen Schluessel notiert. Jeder Wert der obersten
   Ebene ist selbst wieder ein mitschreibendes Objekt — so werden auch die
   verschachtelten Felder (timings, client, meta) mit Praefix erfasst. Keiner
   der Werte ist ein String oder eine Zahl; der Handler uebernimmt also nichts,
   er verraet nur, wonach er fragt. */
function mitschreibenderRumpf(gelesen) {
  const unterobjekt = (praefix) =>
    new Proxy(
      {},
      {
        get(_ziel, schluessel) {
          if (typeof schluessel === "string") gelesen.add(`${praefix}.${schluessel}`);
          return undefined;
        },
      }
    );
  return new Proxy(
    {},
    {
      get(_ziel, schluessel) {
        if (typeof schluessel !== "string") return undefined;
        gelesen.add(schluessel);
        return unterobjekt(schluessel);
      },
    }
  );
}

/* Nur die Blaetter: "client" faellt weg, wenn "client.screen" gelesen wurde. */
function blattpfade(gelesen) {
  const alle = [...gelesen];
  return alle.filter((p) => !alle.some((q) => q.startsWith(`${p}.`))).sort();
}

function antwort() {
  return {
    status() {
      return this;
    },
    json() {
      return this;
    },
    end() {
      return this;
    },
  };
}

const anfrage = (body) => ({ method: "POST", body, headers: {}, ip: "freigabe-" + Math.random() });

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("handle-errors liest genau die Felder seiner Freigabeliste", async () => {
  const gelesen = new Set();
  await handleErrors(anfrage(mitschreibenderRumpf(gelesen)), antwort());
  /* Messmittel-Kontrolle: Hat der Rumpf nichts mitgeschrieben, waere der
     Vergleich unten nur zufaellig gleich. */
  expect(gelesen.size).toBeGreaterThan(10);
  expect(blattpfade(gelesen)).toEqual([...LISTE_ERRORS].sort());
});

test("handle-telemetry liest genau die Felder seiner Freigabeliste (ohne Realitaets-Check-Weg)", async () => {
  const gelesen = new Set();
  await handleTelemetry(anfrage(mitschreibenderRumpf(gelesen)), antwort());
  expect(gelesen.size).toBeGreaterThan(10);
  const normalweg = LISTE_TELEMETRIE.filter((f) => !f.startsWith("stufen.") && f !== "score");
  expect(blattpfade(gelesen)).toEqual([...normalweg].sort());
});
