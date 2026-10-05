/**
 * job-pipelines-zweite-werbung.test.js — auch die Werbung des zweiten
 * KI-Aufrufs läuft durch den Kinderschutz-Filter.
 *
 * Die Werbe-Kärtchen der Beast-Ansicht entstehen in einem eigenen, zweiten
 * Aufruf (generateBeastAds) — nach dem Hauptaufruf, als einziger Weg, auf dem
 * danach noch KI-Text ins Ergebnis kommt. Dass der Filter sie erreicht, hängt
 * allein an der Reihenfolge in job-pipelines.js: erst einsetzen, dann
 * applyMinorSafety. Käme die Reihenfolge bei einem Umbau durcheinander, sähe
 * ein Kind diese Werbung ungefiltert, und keine Protokollzeile zeigte es.
 *
 * Geprüft wird der echte Weg runPipeline; gestellt sind nur die zwei Antworten
 * der KI. Kein Netzwerk, keine Cloud.
 */

const { SATZ } = require("../test-satz");

const KIND = "weiblich, ~13 Jahre alt (Spanne 12-14)";
const ERWACHSEN = "weiblich, ~40 Jahre alt (Spanne 38-45)";

/* Was der zweite Aufruf liefert: je ein Eintrag der Stufe 2 (nur bei
   möglicherweise Minderjährigen gestrichen), der Stufe 1 (bei allen
   gestrichen) und ein harmloser. */
const ZWEITE_WERBUNG = ["Sportwetten Bonus", "Pornhub Premium", "Sammelkarten Abo"];

describe("Werbung des zweiten KI-Aufrufs und der Kinderschutz-Filter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  /** Fährt runPipeline; `zweiterAufruf` ersetzt generateBeastAds. */
  async function lauf({ anker, alterUnlesbar = false, zweiterAufruf }) {
    jest.resetModules();
    jest.doMock("../betriebsprofil", () => ({
      geltendeWerte: async () => ({ werte: SATZ, quelle: "firestore", grund: null }),
    }));
    jest.doMock("../queue-storage", () => ({
      loadImage: async () => ({ buffer: Buffer.from("x"), mimeType: "image/jpeg" }),
      deleteImage: async () => true,
    }));
    const karten = () => ({
      alter_geschlecht: { value: `Du bist ${anker}. Deine Wangen sind noch rund.` },
      interessen: { value: "Du magst Fußball." },
    });
    const generateBeastAds = jest.fn(zweiterAufruf);
    jest.doMock("../mistral", () => ({
      runSingleLargeCall: async () => ({
        normal: {
          categories: karten(),
          ad_targeting: ["Lego Set", "Sofortkredit"],
          manipulation_triggers: [],
          profileText: "Sachlich.",
        },
        boost: {
          categories: karten(),
          ad_targeting: ["Klarna", "Pokemon Karten"],
          manipulation_triggers: [],
          profileText: "Zynisch.",
        },
        alterAnker: anker,
        alterUnlesbar,
      }),
      generateBeastAds,
    }));
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    const { runPipeline } = require("../job-pipelines");
    const mistral = require("../mistral");
    const ergebnis = await runPipeline({
      mistral,
      job: { traceId: "t", imagePath: "queue-uploads/x.jpg", lang: "de", exif: {} },
    });
    return { ergebnis, generateBeastAds, profile: ergebnis.result.profiles };
  }

  test("Kind: aus der zweiten Werbung bleibt nur der harmlose Eintrag", async () => {
    const { ergebnis, generateBeastAds, profile } = await lauf({
      anker: KIND,
      zweiterAufruf: async () => ZWEITE_WERBUNG,
    });
    expect(ergebnis.success).toBe(true);
    /* Positivkontrolle: Der zweite Aufruf lief, und seine Liste — nicht die
       des Hauptaufrufs — steht im Ergebnis. */
    expect(generateBeastAds).toHaveBeenCalledTimes(1);
    expect(profile.boost.ad_targeting).toEqual(["Sammelkarten Abo"]);
    /* Die Standard-Ansicht bleibt daneben gefiltert wie bisher. */
    expect(profile.normal.ad_targeting).toEqual(["Lego Set"]);
  });

  test("Erwachsene: Stufe 2 bleibt stehen, Stufe 1 fällt auch aus der zweiten Werbung", async () => {
    const { generateBeastAds, profile } = await lauf({ anker: ERWACHSEN, zweiterAufruf: async () => ZWEITE_WERBUNG });
    expect(generateBeastAds).toHaveBeenCalledTimes(1);
    expect(profile.boost.ad_targeting).toEqual(["Sportwetten Bonus", "Sammelkarten Abo"]);
    expect(profile.normal.ad_targeting).toEqual(["Lego Set", "Sofortkredit"]);
  });

  test("Alter nicht lesbar: die zweite Werbung wird gefiltert wie bei einem Kind", async () => {
    const { generateBeastAds, profile } = await lauf({
      anker: "weiblich",
      alterUnlesbar: true,
      zweiterAufruf: async () => ZWEITE_WERBUNG,
    });
    expect(generateBeastAds).toHaveBeenCalledTimes(1);
    expect(profile.boost.ad_targeting).toEqual(["Sammelkarten Abo"]);
  });

  test("fällt der zweite Aufruf aus, bleibt die Liste des Hauptaufrufs — gefiltert", async () => {
    const { ergebnis, generateBeastAds, profile } = await lauf({
      anker: KIND,
      zweiterAufruf: async () => {
        throw new Error("zweiter Aufruf nicht erreichbar");
      },
    });
    expect(ergebnis.success).toBe(true);
    expect(generateBeastAds).toHaveBeenCalledTimes(1);
    expect(profile.boost.ad_targeting).toEqual(["Pokemon Karten"]);
  });

  test("liefert der zweite Aufruf nichts, bleibt die Liste des Hauptaufrufs — gefiltert", async () => {
    const { generateBeastAds, profile } = await lauf({ anker: KIND, zweiterAufruf: async () => null });
    expect(generateBeastAds).toHaveBeenCalledTimes(1);
    expect(profile.boost.ad_targeting).toEqual(["Pokemon Karten"]);
  });
});
