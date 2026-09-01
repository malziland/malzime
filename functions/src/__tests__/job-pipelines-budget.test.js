/**
 * job-pipelines-budget.test.js — Schrumpft das Zeitbudget waehrend des Laufs?
 *
 * BEFUND 01.09.2026 (Runde 7, K-9/L-6): Die Mutation `remainingBudget = () =>
 * budgetMs` (job-pipelines.js:64) ueberlebte die volle Suite. Der Grund ist
 * lehrreich: wirkung-jeder-wert.test.js misst den Rueckgabewert EINMAL, sofort
 * nach dem Start. Da ist die verstrichene Zeit nahe null, und die kaputte
 * Fassung liefert denselben Wert wie die richtige. Gemessen wurde also, dass
 * das Budget aus dem Satz kommt — nicht, dass es vergeht.
 *
 * Was daran haengt: Beim Drei-Aufruf-Weg bekommt jeder Aufruf das RESTbudget.
 * Schrumpft es nicht, darf der zweite Aufruf noch einmal die volle Zeit
 * verbrauchen — die Zeitgrenze des Durchlaufs waere wirkungslos. Genau diese
 * Klasse von Fehler hat der Betriebsvorfall vom 28.08.2026 sichtbar gemacht.
 *
 * BEFUND (Runde 7, L-16): job-pipelines.js hatte ueberhaupt keine eigene
 * Testdatei. Das hier ist ihr Anfang.
 */

const { SATZ } = require("../test-satz");

describe("Restbudget waehrend des Durchlaufs", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  /** Baut die Attrappen und liefert die Messwerte des Mistral-Aufrufs. */
  async function messeRestbudget({ budgetMs, vergangen }) {
    jest.resetModules();
    jest.doMock("../betriebsprofil", () => ({
      geltendeWerte: async () => ({
        werte: { ...SATZ, requestBudgetMs: budgetMs },
        quelle: "firestore",
        grund: null,
      }),
    }));
    jest.doMock("../queue-storage", () => ({
      loadImage: async () => ({ buffer: Buffer.from("x"), mimeType: "image/jpeg" }),
      deleteImage: async () => true,
    }));

    /* Die Uhr wird gestellt, nicht abgewartet: Der Lauf soll Millisekunden
       dauern, die Messung aber Minuten abbilden. */
    const echteJetzt = Date.now();
    let versatz = 0;
    jest.spyOn(Date, "now").mockImplementation(() => echteJetzt + versatz);

    const messwerte = [];
    jest.doMock("../mistral", () => {
      const nimm = async (_b, _m, remainingBudget) => {
        messwerte.push(remainingBudget());
        versatz += vergangen;
        messwerte.push(remainingBudget());
        return null;
      };
      return { runSingleLargeCall: nimm, describeImage: nimm };
    });

    const { runPipeline } = require("../job-pipelines");
    const mistral = require("../mistral");
    await runPipeline({
      mistral,
      job: { traceId: "t", imagePath: "queue-uploads/x.jpg", lang: "de", exif: {} },
    }).catch(() => {});
    return messwerte;
  }

  test("verbrauchte Zeit fehlt im Restbudget", async () => {
    const [vorher, nachher] = await messeRestbudget({ budgetMs: 300000, vergangen: 90000 });
    expect(vorher).toBeGreaterThan(0);
    /* Genau die verstrichene Zeit weniger — nicht "irgendwie kleiner". */
    expect(nachher).toBe(vorher - 90000);
  });

  test("das Budget faellt nicht unter null", async () => {
    /* Math.max(0, …): Ein negativer Wert waere kein Restbudget, sondern eine
       Zeitgrenze, die als "unbegrenzt" durchgereicht wird — je nachdem, wie
       der Empfaenger sie liest. */
    const [, nachher] = await messeRestbudget({ budgetMs: 60000, vergangen: 200000 });
    expect(nachher).toBe(0);
  });

  test("ohne verstrichene Zeit steht das volle Budget aus dem Satz bereit", async () => {
    const [vorher] = await messeRestbudget({ budgetMs: 250000, vergangen: 0 });
    expect(vorher).toBe(250000);
  });
});
