/**
 * mistral-rettung.test.js — Ein fertig geschriebenes Ergebnis darf nicht an
 * der Uhr sterben.
 *
 * HINTERGRUND (BUG-2026-08-28-02): Am 28.08.2026 brachen rund die Haelfte aller
 * Analysen mit "technischer Fehler" ab. In JEDEM gescheiterten Job lagen beide
 * Profiltexte fertig in Firestore (612 und 1233 Zeichen im gemessenen Fall) —
 * der Nutzer hatte sie sogar schon im Live-Text gesehen. Trotzdem stand im
 * Ergebnis `profiles: null` und `blockedReason: blocked.apiError`.
 *
 * Der Grund war nicht fehlende Reparatur: `parseSafely` bringt die
 * Truncation-Recovery fuer abgeschnittenes JSON mit. Sie war nur nie
 * erreichbar, weil der Reader beim Abbruch einen AbortError warf und der
 * gelesene Text mit dem Stack-Frame verschwand.
 *
 * Reine Mock-Pruefung — kein Netzwerk, keine Cloud.
 */

/* Betriebswerte kommen seit 30.08.2026 ausschliesslich aus Firestore. Fuer
   Tests, die eine Analyse durchspielen, wird hier ein gueltiger Satz gestellt —
   sonst bricht jeder Aufruf mit "Betriebswerte fehlen" ab, was diese Tests
   nicht pruefen wollen. Wer das Verhalten OHNE Satz prueft, tut das in
   betriebsprofil*.test.js. */
jest.mock("../betriebsprofil", () => ({
  geltendeWerte: async () => ({
    werte: {
      mistralTimeoutMs: 90000,
      singleLargeTimeoutMs: 300000,
      singleLargeMaxTokens: 5000,
      requestBudgetMs: 480000,
      describeMaxTokens: 2048,
      profileMaxTokens: 16000,
      parallelitaet: 7,
      stundenlimit: 500,
      adressLimit: 500,
    },
    quelle: "firestore",
    profil: "test",
    grund: null,
  }),
  PFLICHTFELDER: ["mistralTimeoutMs", "singleLargeTimeoutMs", "singleLargeMaxTokens", "requestBudgetMs"],
}));

const { setFetchForTest, runSingleLargeCall } = require("../mistral");

const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;
beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
});
afterEach(() => {
  setFetchForTest(null);
  if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
});

/* Ein Modellantwort-Praefix, wie er nach ~150 s im Strom steht: beide
   profileText-Werte vollstaendig, das JSON danach mitten in den Karten
   abgeschnitten — genau die Form, die am 28.08. verworfen wurde. */
const ABGESCHNITTEN = JSON.stringify({
  subject: "HUMAN",
  standard: { profileText: "Du bist ein Mann Anfang dreissig.", categories: { alter_geschlecht: { value: "30-35" } } },
  beast: { profileText: "Wir wissen, dass du gerne wanderst.", categories: { alter_geschlecht: { value: "30-35" } } },
}).slice(
  0,
  -3
); /* Nur die schliessenden Klammern fehlen — die Form, in der ein Strom mitten im Schreiben stehenbleibt */

function sseStromDerAbbricht(text) {
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  return {
    ok: true,
    status: 200,
    body: (() => {
      let gesendet = false;
      return new ReadableStream({
        pull(controller) {
          /* Erst liefern, DANN abbrechen. Beides im selben Schritt wuerde den
             Chunk verwerfen — der Reader saehe nie Text, und der Test pruefte
             etwas anderes als den Betriebsfall. */
          if (!gesendet) {
            gesendet = true;
            controller.enqueue(bytes);
            return;
          }
          const abbruch = new Error("The operation was aborted.");
          abbruch.name = "AbortError";
          controller.error(abbruch);
        },
      });
    })(),
  };
}

describe("Rettung eines abgebrochenen Single-Large-Laufs", () => {
  test("beide Profile ueberleben den Abbruch der Uhr", async () => {
    setFetchForTest(async () => sseStromDerAbbricht(ABGESCHNITTEN));

    const ergebnis = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", null, "de", {
      /* Ohne Callback streamt mistral.js nicht — und ohne Strom gibt es
         keinen Teiltext, der gerettet werden koennte. */
      onLiveText: () => {},
    });

    expect(ergebnis).not.toBeNull();
    expect(ergebnis.normal.profileText).toContain("Anfang dreissig");
    expect(ergebnis.boost.profileText).toContain("wanderst");
  });

  test("ohne brauchbaren Teiltext bleibt es beim Fehler", async () => {
    setFetchForTest(async () => sseStromDerAbbricht('{"subj'));

    await expect(
      runSingleLargeCall(Buffer.from("bild"), "image/jpeg", null, "de", { onLiveText: () => {} })
    ).rejects.toThrow(/timeout/i);
  });
});
