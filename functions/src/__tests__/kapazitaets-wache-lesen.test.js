/**
 * kapazitaets-wache-lesen.test.js — Was liest `echteParallelitaet` aus der
 * Antwort von Google heraus, und was verwirft sie?
 *
 * BEFUND 01.09.2026 (Runde 7, K-9/L-6): Zwei Mutationen an derselben Zeile
 * (kapazitaets-wache.js:82) ueberlebten die volle Suite:
 *   `wert > 0`  ->  `wert >= 0`   und   `&&`  ->  `||`
 * Die Zeile entscheidet, ob ein gelesener Wert als Messung gilt. Ist sie
 * kaputt, meldet die Wache eine Zahl, die keine ist — oder haelt eine
 * stehende Warteschlange (0 Plaetze) fuer einen gueltigen Betriebswert und
 * vergleicht den Code dagegen.
 *
 * kapazitaets-wache.test.js prueft die Bewertung; hier geht es um die Zeile
 * davor, die entscheidet, ob ueberhaupt etwas zu bewerten ist.
 */

const wache = require("../kapazitaets-wache");

/** Eine Cloud-Tasks-Attrappe, die genau diese eine Antwort liefert. */
function clientMit(rateLimits) {
  return {
    queuePath: (p, r, n) => `projects/${p}/locations/${r}/queues/${n}`,
    async getQueue() {
      return [{ rateLimits }];
    },
  };
}

const PROJEKT = process.env.GCLOUD_PROJECT;

beforeAll(() => {
  /* echteParallelitaet steigt ohne Projektkennung sofort aus — dann misst
     diese Datei den falschen Riegel und waere immer gruen. */
  process.env.GCLOUD_PROJECT = "malzime-test";
});

afterAll(() => {
  if (PROJEKT === undefined) delete process.env.GCLOUD_PROJECT;
  else process.env.GCLOUD_PROJECT = PROJEKT;
  wache.setClientForTest(null);
});

describe("echteParallelitaet liest die Warteschlange", () => {
  test("eine gueltige Zahl kommt durch", async () => {
    wache.setClientForTest(clientMit({ maxConcurrentDispatches: 7 }));
    await expect(wache.echteParallelitaet()).resolves.toBe(7);
  });

  test("0 Plaetze sind KEIN Betriebswert, sondern eine stehende Warteschlange", async () => {
    /* Deckt `wert > 0` gegen `wert >= 0` ab: Mit >= 0 kaeme hier 0 zurueck,
       und die Wache verglichen den Code gegen eine Warteschlange, die gar
       nichts durchlaesst — sie meldete "Code verspricht zu viel" statt
       "nicht messbar". */
    wache.setClientForTest(clientMit({ maxConcurrentDispatches: 0 }));
    await expect(wache.echteParallelitaet()).resolves.toBeNull();
  });

  test("eine negative Zahl gilt nicht als Messung", async () => {
    wache.setClientForTest(clientMit({ maxConcurrentDispatches: -1 }));
    await expect(wache.echteParallelitaet()).resolves.toBeNull();
  });

  test.each([
    ["7", "Zeichenkette statt Zahl"],
    [null, "ausdruecklich leer"],
    [undefined, "Feld fehlt"],
    [{}, "Objekt"],
    [NaN, "keine Zahl"],
  ])("%p gilt nicht als Messung (%s)", async (wert) => {
    /* Deckt `&&` gegen `||` ab: Mit `||` reichte `wert > 0` allein, und die
       Zeichenkette "7" kaeme als "7" zurueck — ab da rechnet die Wache mit
       einem Wert, dessen Typ sie nie geprueft hat. */
    wache.setClientForTest(clientMit({ maxConcurrentDispatches: wert }));
    await expect(wache.echteParallelitaet()).resolves.toBeNull();
  });

  test("fehlende rateLimits sind nicht messbar, kein Befund", async () => {
    wache.setClientForTest(clientMit(undefined));
    await expect(wache.echteParallelitaet()).resolves.toBeNull();
  });
});

/* `echteRate` liest dieselbe Antwort mit derselben Zeile, nur ein Feld weiter.
   Der Befund nannte sie nicht — sie war aber genauso ungedeckt, und eine
   Luecke, die man beim Schliessen der Nachbarluecke sieht, laesst man nicht
   offen. */
describe("echteRate liest die Warteschlange", () => {
  test("eine gueltige Zahl kommt durch", async () => {
    wache.setClientForTest(clientMit({ maxDispatchesPerSecond: 0.125 }));
    await expect(wache.echteRate()).resolves.toBe(0.125);
  });

  test("0 pro Sekunde ist keine Rate, sondern Stillstand", async () => {
    wache.setClientForTest(clientMit({ maxDispatchesPerSecond: 0 }));
    await expect(wache.echteRate()).resolves.toBeNull();
  });

  test.each([
    ["0.125", "Zeichenkette statt Zahl"],
    [null, "ausdruecklich leer"],
    [undefined, "Feld fehlt"],
    [NaN, "keine Zahl"],
  ])("%p gilt nicht als Messung (%s)", async (wert) => {
    wache.setClientForTest(clientMit({ maxDispatchesPerSecond: wert }));
    await expect(wache.echteRate()).resolves.toBeNull();
  });
});
