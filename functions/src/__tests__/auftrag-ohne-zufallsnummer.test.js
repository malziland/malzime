/* Der gespeicherte Auftrag und sein Ergebnis fuehren die Zufallsnummer des
   Browsers nicht (PRIV-2026-10-03-39).

   Der Datenschutztext nennt fuer das gespeicherte Profil: das Profil,
   Hersteller und Modell der Kamera, die Sprache. Die Zufallsnummer eines
   Durchgangs nennt er dort nicht — und der Server braucht sie im Auftrag
   nicht: Der Verarbeiter schreibt sie in keine Zeile, und der Browser liest
   sie aus dem Ergebnis nicht (er kennt seine Nummer selbst).

   Hier: das Ergebnis auf allen drei Wegen (Mensch, Tier, gesperrt) und das
   Ersatz-Ergebnis. Dass der Einlass sie nicht in den Auftrag legt, haelt
   handle-enqueue.test.js fest; dass createJob kein solches Feld anlegt,
   jobs.test.js. */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

jest.mock("../jobs", () => ({
  getJob: jest.fn(),
  claimJob: jest.fn(),
  completeJob: jest.fn(),
  isAbandoned: jest.fn(),
  abandonJob: jest.fn(),
  countProcessingJobs: jest.fn(),
  setLiveText: jest.fn(),
}));
jest.mock("../queue-storage", () => ({ loadImage: jest.fn(), deleteImage: jest.fn() }));
jest.mock("../counter", () => ({ incrementTotals: jest.fn(() => Promise.resolve()) }));
jest.mock("../cloud-tasks", () => ({ redispatchJobLocal: jest.fn() }));
jest.mock("../feature-flags", () => ({ isBeastAdsCallEnabled: jest.fn(async () => false) }));
jest.mock("../mistral", () => ({ runSingleLargeCall: jest.fn() }));

const { runPipeline } = require("../handle-process-job");
const storage = require("../queue-storage");
const mistral = require("../mistral");

const NUMMER = "zufall4711geheim";
/* So sieht ein Auftrag aus, der vor dieser Aenderung angelegt wurde und noch
   bis zu zwei Stunden liegt: Er traegt die Nummer noch. */
const ALTER_AUFTRAG = { lang: "de", exif: { make: "Apple", model: "iPhone" }, imagePath: "p", traceId: NUMMER };

function profil() {
  return {
    categories: { alter_geschlecht: { value: "Du bist männlich, ~30.", label: "Alter & Geschlecht", confidence: 0.8 } },
    profileText: "Du bist eine Person mit aktivem Lebensstil.",
    ad_targeting: [],
    manipulation_triggers: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.MISTRAL_MOCK;
  storage.loadImage.mockResolvedValue({ buffer: Buffer.from("img"), mimeType: "image/jpeg" });
  storage.deleteImage.mockResolvedValue();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("das Ergebnis traegt die Zufallsnummer nicht — auch nicht aus einem aelteren Auftrag", () => {
  test("Mensch im Bild", async () => {
    mistral.runSingleLargeCall.mockResolvedValue({
      normal: profil(),
      boost: profil(),
      subject: "HUMAN",
      visibleText: "",
    });
    const { result } = await runPipeline(ALTER_AUFTRAG);
    /* Erfolgsweg: Das Ergebnis ist da und traegt, was der Browser braucht. */
    expect(result.profiles.normal.profileText).toContain("aktivem Lebensstil");
    expect(result.meta).toEqual({ mode: "multimodal", subject: "HUMAN", alterUnlesbar: false });
    expect(JSON.stringify(result)).not.toContain(NUMMER);
  });

  test("nur ein Tier im Bild", async () => {
    mistral.runSingleLargeCall.mockResolvedValue({
      normal: profil(),
      boost: profil(),
      subject: "ANIMAL_ONLY",
      visibleText: "",
    });
    const { result } = await runPipeline(ALTER_AUFTRAG);
    expect(result.meta).toEqual({ mode: "animal" });
    expect(JSON.stringify(result)).not.toContain(NUMMER);
  });

  test("kein auswertbares Profil (gesperrt)", async () => {
    mistral.runSingleLargeCall.mockResolvedValue({ normal: null, boost: null, subject: "", visibleText: "" });
    const { result } = await runPipeline(ALTER_AUFTRAG);
    expect(result.profiles).toBeNull();
    expect(result.meta).toEqual({ mode: "blocked" });
    expect(JSON.stringify(result)).not.toContain(NUMMER);
  });

  test("Ersatz-Ergebnis nach einem unerwarteten Fehler", () => {
    const ersatz = jest.requireActual("../jobs").ersatzErgebnis(ALTER_AUFTRAG);
    expect(ersatz.meta).toEqual({ mode: "blocked" });
    /* Erfolgsweg: Die Kamera-Angaben des Auftrags bleiben im Ergebnis. */
    expect(ersatz.exif).toEqual({ make: "Apple", model: "iPhone" });
    expect(JSON.stringify(ersatz)).not.toContain(NUMMER);
  });
});
