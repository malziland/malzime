/* PRIV-002 (Audit 2026-06): Die Datenschutz-Warnung ("das hast du ungewollt
   verraten") + das Tier-Easter-Egg müssen im AKTIVEN Single-Large-Pfad wieder
   funktionieren. Regression-Schutz: subject/visible_text aus dem KI-JSON werden
   server-seitig zu SUBJECT-/"Sichtbarer Text:"-Markern verdrahtet, sodass
   classifyDescription + buildPrivacyRisks (real) anschlagen.

   Aufbau: jobs/storage/counter/cloud-tasks gemockt; feature-flags → Single-Large
   AN; ../mistral durch einen Stub mit kontrolliertem runSingleLargeCall ersetzt.
   privacy.js und animal.js bleiben REAL — also echte End-to-End-Verdrahtung. */

/* Der Einstellungssatz als Kulisse: Dieser Test prueft etwas anderes, braucht
   aber Betriebswerte in der Kette. Was OHNE Satz passiert, prueft
   ohne-einstellungssatz.test.js — an EINER Stelle, fuer alle Wege. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

jest.mock("../jobs", () => ({
  getJob: jest.fn(),
  claimJob: jest.fn(),
  completeJob: jest.fn(),
  isAbandoned: jest.fn(),
  abandonJob: jest.fn(),
  countProcessingJobs: jest.fn(),
}));
jest.mock("../queue-storage", () => ({ loadImage: jest.fn(), deleteImage: jest.fn() }));
jest.mock("../counter", () => ({ incrementTotals: jest.fn(() => Promise.resolve()) }));
jest.mock("../cloud-tasks", () => ({ redispatchJobLocal: jest.fn() }));
jest.mock("../feature-flags", () => ({ isSingleLargeCallEnabled: jest.fn() }));
jest.mock("../mistral", () => ({ runSingleLargeCall: jest.fn() }));

const { runPipeline } = require("../handle-process-job");
const storage = require("../queue-storage");
const flags = require("../feature-flags");
const mistral = require("../mistral");

function profileWithCategory() {
  return {
    categories: { alter_geschlecht: { value: "Du bist männlich, ~30.", label: "Alter & Geschlecht", confidence: 0.8 } },
    profileText: "Du bist eine Person mit aktivem Lebensstil.",
    ad_targeting: [],
    manipulation_triggers: [],
  };
}

describe("handle-process-job — PRIV-002 (Single-Large Datenschutz-Warnung)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.MISTRAL_MOCK; /* getMistral() nutzt dann den gemockten ../mistral */
    flags.isSingleLargeCallEnabled.mockResolvedValue(true);
    storage.loadImage.mockResolvedValue({ buffer: Buffer.from("img"), mimeType: "image/jpeg" });
    storage.deleteImage.mockResolvedValue();
  });

  test("visible_text mit Adresse + Telefon erzeugt privacy.address UND privacy.phone", async () => {
    mistral.runSingleLargeCall.mockResolvedValue({
      normal: profileWithCategory(),
      boost: profileWithCategory(),
      subject: "HUMAN",
      visibleText: "Hauptstraße 5; 0664 1234567",
    });
    const { result } = await runPipeline({ lang: "de", exif: {}, imagePath: "p", traceId: "t" });
    expect(result.privacyRisks).toContain("privacy.address");
    expect(result.privacyRisks).toContain("privacy.phone");
  });

  test("leerer visible_text erzeugt KEINE Warnung (kein False Positive)", async () => {
    mistral.runSingleLargeCall.mockResolvedValue({
      normal: profileWithCategory(),
      boost: profileWithCategory(),
      subject: "HUMAN",
      visibleText: "",
    });
    const { result } = await runPipeline({ lang: "de", exif: {}, imagePath: "p" });
    expect(result.privacyRisks).not.toContain("privacy.address");
    expect(result.privacyRisks).not.toContain("privacy.phone");
  });

  test("subject ANIMAL_ONLY löst das Tier-Easter-Egg aus (mode=animal)", async () => {
    mistral.runSingleLargeCall.mockResolvedValue({
      normal: {
        categories: {},
        profileText: "Ein Hund sitzt im Gras und schaut in die Kamera.",
        ad_targeting: [],
        manipulation_triggers: [],
      },
      boost: { categories: {}, profileText: "", ad_targeting: [], manipulation_triggers: [] },
      subject: "ANIMAL_ONLY",
      visibleText: "",
    });
    const { result } = await runPipeline({ lang: "de", exif: {}, imagePath: "p" });
    expect(result.meta.mode).toBe("animal");
  });

  test("fehlende subject/visible_text-Felder → kein Crash (Fallback-Verhalten)", async () => {
    mistral.runSingleLargeCall.mockResolvedValue({
      normal: profileWithCategory(),
      boost: profileWithCategory(),
      /* subject + visibleText fehlen (alter Prompt-Stand) */
    });
    const { result, success } = await runPipeline({ lang: "de", exif: {}, imagePath: "p" });
    expect(success).toBe(true);
    expect(Array.isArray(result.privacyRisks)).toBe(true);
  });

  /* ── Regressionsschutz zum Audit-Befund BUG-001 (2026-08-10) ──────────────
     Bis v2.9.1 lief hier eine Widerspruchspruefung, die NICHT die Bild-
     beschreibung des Modells prüfte, sondern den daraus erzeugten Profiltext
     (der im Single-Large-Pfad aus profileText + allen Kartenwerten
     zusammengesetzt wird). Ein Jugendlicher mit „Apex Legends" in den
     Interessen bekam dadurch statt seiner Analyse ein Tier-Profil — „ape"
     steckte im Wortstamm. Umgekehrt griff sie beim echten Affenbild nie.

     Diese Tests halten fest: Solange das Modell HUMAN meldet, bleibt es ein
     Menschenprofil — egal welche Wörter im Text stehen. */

  test.each([
    ["Gaming", "Du spielst Apex Legends und Fortnite jeden Abend."],
    ["Impulskauf", "Du handelst aus dem Affekt heraus und kaufst impulsiv."],
    ["Winterjacke", "Der Kragen deiner Jacke ist mit Fell besetzt."],
    ["Redewendung", "Du hast die Schnauze voll von Werbung."],
    ["Englisch", "She wears a fur coat and a fur hat."],
  ])("HUMAN bleibt HUMAN, auch bei Tier-Wörtern im Profiltext: %s", async (_name, text) => {
    mistral.runSingleLargeCall.mockResolvedValue({
      normal: {
        categories: {
          alter_geschlecht: { value: "Du bist männlich, ~15 (Spanne 13-17).", label: "Alter", confidence: 0.7 },
          interessen: { value: text, label: "Interessen", confidence: 0.8 },
        },
        profileText: text,
        ad_targeting: [],
        manipulation_triggers: [],
      },
      boost: profileWithCategory(),
      subject: "HUMAN",
      visibleText: "",
    });
    const { result } = await runPipeline({ lang: "de", exif: {}, imagePath: "p" });
    expect(result.meta.mode).toBe("multimodal");
    expect(result.meta.mode).not.toBe("animal");
  });
});
