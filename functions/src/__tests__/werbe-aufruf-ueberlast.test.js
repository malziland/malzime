"use strict";

/* Wie laut ein Ausfall des Werbe-Aufrufs gemeldet wird (mistral.js,
   generateBeastAds).

   Faellt der Aufruf aus, bleibt die Werbeliste aus dem Hauptaufruf stehen —
   das Kind bekommt sein Ergebnis. Ein KURZER AUSSETZER von Mistral ist deshalb
   nur eine Warnung, kein Alarm: Ueberlast (429, seit OPS-2026-10-03-31) und
   seit 21.10.2026 auch 502/503/504, die Zeitgrenze und ein Verbindungsabriss.
   Beleg 21.10.2026, 10:25–10:40 Wien: 14-mal 503 und 4-mal Zeitgrenze, 18
   Fehlerzeilen, die Nachricht "Fehler im Server" kam wiederholt, obwohl alle
   81 Analysen fertig waren. Vorgabe Christoph 21.10.2026.

   JEDER ANDERE Fehlschlag bleibt eine Fehlerzeile mit Alarm: Ein dauerhaft
   kaputter Zweitaufruf soll sofort auffallen (OPS-004). Einen langen
   Aussetzer meldet die Werbe-Wache (werbe-wache.test.js) — dafuer vermerkt
   der Aufruf sein Ergebnis in der Messung (werbeAufruf). */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const mistral = require("../mistral");
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

const API_KEY_VORHER = process.env.MISTRAL_API_KEY;
const PROFIL = {
  profileText: "Du wirkst aufmerksam.",
  categories: {
    alter_geschlecht: { label: "Alter", value: "Du bist erwachsen.", confidence: 0.8 },
    verletzlichkeit: { label: "V", value: "Du vergleichst dich.", confidence: 0.8 },
    gesundheit: { label: "G", value: "Du bist fit.", confidence: 0.8 },
    kaufkraft: { label: "K", value: "Mittel.", confidence: 0.8 },
  },
};

let fehler;
let warnung;
let aufrufe;
const zeilen = (spion) => spion.mock.calls.map((aufruf) => JSON.parse(aufruf[0]));
const werbeZeilen = (spion) => zeilen(spion).filter((zeile) => zeile.alert === "beast-ads-failed");

function kiAntwortet(status, inhalt = '{"ad_targeting":["A","B"]}') {
  aufrufe = 0;
  mistral.setFetchForTest(async () => {
    aufrufe += 1;
    if (status !== 200) return { ok: false, status, headers: { get: () => null }, text: async () => "abgelehnt" };
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: inhalt } }], usage: {} }),
    };
  });
}

/* Der Aufruf wirft, bevor eine Antwort kommt. */
function kiWirft(fabrik) {
  aufrufe = 0;
  mistral.setFetchForTest(async () => {
    aufrufe += 1;
    throw fabrik();
  });
}

/* So meldet Node.js einen Abbruch durch den eigenen Zeitwaechter (der
   AbortController der Netzschicht): Die Netzschicht macht daraus ihren
   Zeitgrenzen-Fehler (code "timeout"). Nachgestellt ohne 30 s zu warten. */
const zeitwaechterBrichtAb = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
/* So meldet Node.js (undici) eine abgerissene Verbindung. */
const verbindungReisstAb = () => {
  const grund = new Error("read ECONNRESET");
  grund.code = "ECONNRESET";
  return new TypeError("fetch failed", { cause: grund });
};

beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  _setRateIntervalMs(0);
  _resetRateBucket();
  jest.spyOn(console, "log").mockImplementation(() => {});
  fehler = jest.spyOn(console, "error").mockImplementation(() => {});
  warnung = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (API_KEY_VORHER === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = API_KEY_VORHER;
  mistral.setFetchForTest(null);
  jest.restoreAllMocks();
});

/* Ein kurzer Aussetzer: keine Werbeliste, genau eine Warnung, keine
   Fehlerzeile, Ergebnis "aussetzer" in der Messung. */
async function erwarteAussetzer() {
  const messung = {};
  const liste = await mistral.generateBeastAds(PROFIL, ["X"], "de", messung);
  expect(liste).toBeNull();
  expect(fehler).not.toHaveBeenCalled();
  expect(werbeZeilen(warnung)).toHaveLength(1);
  expect(werbeZeilen(warnung)[0]).toMatchObject({ severity: "WARNING", step: "mistral-beast-ads", status: "failed" });
  expect(messung.werbeAufruf).toBe("aussetzer");
}

/* Jeder andere Fehlschlag: eine Fehlerzeile mit alert, keine Warnung,
   Ergebnis "fehler" in der Messung. Gibt die Fehlerzeile zurueck; der Test
   prueft daran, dass sie den richtigen Grund nennt. */
async function erwarteFehler() {
  const messung = {};
  const liste = await mistral.generateBeastAds(PROFIL, ["X"], "de", messung);
  expect(liste).toBeNull();
  expect(werbeZeilen(warnung)).toHaveLength(0);
  expect(werbeZeilen(fehler)).toHaveLength(1);
  expect(werbeZeilen(fehler)[0]).toMatchObject({ severity: "ERROR", step: "mistral-beast-ads", status: "failed" });
  expect(messung.werbeAufruf).toBe("fehler");
  return werbeZeilen(fehler)[0];
}

describe("kurze Aussetzer: Warnung, kein Alarm", () => {
  test("429 bei jedem Versuch (Ueberlast)", async () => {
    kiAntwortet(429);
    await erwarteAussetzer();
    expect(aufrufe).toBeGreaterThan(1);
  });

  test.each([[502], [503], [504]])("HTTP %i bei jedem Versuch (Mistral kurz weg)", async (status) => {
    kiAntwortet(status);
    await erwarteAussetzer();
    /* Die Netzschicht hat es wiederholt, bevor sie aufgab. */
    expect(aufrufe).toBeGreaterThan(1);
  });

  test("Zeitgrenze des Aufrufs", async () => {
    kiWirft(zeitwaechterBrichtAb);
    await erwarteAussetzer();
    expect(werbeZeilen(warnung)[0].error).toMatch(/timeout/);
  });

  test("Verbindungsabriss — der Grund steht in der Warnung, ohne Adressen", async () => {
    kiWirft(verbindungReisstAb);
    await erwarteAussetzer();
    expect(werbeZeilen(warnung)[0].ursache).toEqual({ code: "ECONNRESET", text: "read ECONNRESET" });
  });
});

describe("jeder andere Fehlschlag: weiter eine Fehlerzeile mit Alarm", () => {
  test.each([[400], [401], [404], [500]])("HTTP %i", async (status) => {
    kiAntwortet(status);
    expect((await erwarteFehler()).error).toContain(`HTTP ${status}`);
  });

  test("Antwort-Rumpf ist kein JSON", async () => {
    mistral.setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      },
    }));
    expect((await erwarteFehler()).error).toMatch(/JSON/);
  });

  test("Zugangsschluessel fehlt", async () => {
    const euVorher = process.env.MISTRAL_API_KEY_EU;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY_EU;
    try {
      kiAntwortet(200);
      expect((await erwarteFehler()).error).toMatch(/MISTRAL_API_KEY/);
    } finally {
      if (euVorher !== undefined) process.env.MISTRAL_API_KEY_EU = euVorher;
    }
  });
});

/* Die Entscheidung selbst (ueberlast.js): Code, Status und Markierung —
   nie eine Zahl im freien Text, wie bei istUeberlast (BUG-2026-10-03-34). */
describe("istKurzerAussetzer", () => {
  const { istKurzerAussetzer } = require("../ueberlast");
  const mit = (felder, text = "x") => Object.assign(new Error(text), felder);

  test.each([
    ["429", mit({ status: 429 })],
    ["eigene Drossel aufgelaufen", mit({ code: "throttle_timeout" })],
    ["502", mit({ status: 502 })],
    ["503", mit({ status: 503 })],
    ["504", mit({ status: 504 })],
    ["Zeitgrenze", mit({ code: "timeout" })],
    ["markierter Abriss", mit({ verbindungsabbruch: true })],
    ["Abriss mit Fehlercode", verbindungReisstAb()],
  ])("%s: kurzer Aussetzer", (_name, err) => {
    expect(istKurzerAussetzer(err)).toBe(true);
  });

  test.each([
    ["500", mit({ status: 500 })],
    ["400", mit({ status: 400 })],
    ["503 nur im Text", mit({}, "Mistral HTTP 503: kurz weg")],
    ["timeout nur im Text", mit({}, "timeout nach 30000 ms")],
    ["kein Fehler", null],
  ])("%s: kein kurzer Aussetzer", (_name, err) => {
    expect(istKurzerAussetzer(err)).toBe(false);
  });
});

describe("Ergebnis in der Messung bei einer Antwort", () => {
  test("Erfolg: weder Warnung noch Fehlerzeile, Ergebnis ok", async () => {
    kiAntwortet(200);
    const messung = {};
    const liste = await mistral.generateBeastAds(PROFIL, ["X"], "de", messung);
    expect(liste).toEqual(["A", "B"]);
    expect(werbeZeilen(warnung)).toHaveLength(0);
    expect(fehler).not.toHaveBeenCalled();
    expect(messung.werbeAufruf).toBe("ok");
  });

  test("Antwort ohne Eintraege: keine Liste, kein Alarm, Ergebnis leer", async () => {
    kiAntwortet(200, '{"ad_targeting":[]}');
    const messung = {};
    const liste = await mistral.generateBeastAds(PROFIL, ["X"], "de", messung);
    expect(liste).toBeNull();
    expect(werbeZeilen(warnung)).toHaveLength(0);
    expect(fehler).not.toHaveBeenCalled();
    expect(messung.werbeAufruf).toBe("leer");
  });

  test("ohne Messung laeuft der Aufruf wie vorher", async () => {
    kiAntwortet(503);
    await expect(mistral.generateBeastAds(PROFIL, ["X"], "de")).resolves.toBeNull();
  });
});
