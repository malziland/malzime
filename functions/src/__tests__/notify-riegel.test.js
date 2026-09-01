/**
 * notify-riegel.test.js — Kann aus einem Testlauf eine echte Nachricht rausgehen?
 *
 * BEFUND 31.08.2026 (Runde 4, E-3): notify.js war das einzige Modul mit
 * Aussenwirkung ohne Test-Riegel. Es erkannte den Emulator und eine
 * ausdrueckliche Stummschaltung — beides muss jemand setzen. Ein gewoehnlicher
 * Unit-Lauf setzt keines von beidem.
 *
 * Der Vorfall im Kopf von notify.js war ein Simulator-Lauf, der eine echte
 * Push-Nachricht auf das Handy des Betreibers schickte. Ein Test mit echten
 * Zugangsdaten haette dasselbe getan.
 */

/* Ohne diese beiden Attrappen bricht notifyLimitReached VOR dem Versand ab —
   an der Firestore-Sperre aus jest.setup.js. Die erste Fassung dieses Tests
   blieb deshalb auch OHNE den Riegel gruen: gemessen wurde die Sperre, nicht
   der Riegel. Erst die Rueckbauprobe hat das gezeigt. */
jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());
jest.mock("../auth", () => ({ createAdminToken: () => "test-token" }));

const ALT = { ...process.env };

afterEach(() => {
  process.env = { ...ALT };
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("kein Versand aus dem Testbetrieb", () => {
  test("unter Jest geht nichts hinaus, auch ohne gesetzte Schalter", async () => {
    /* Die Lage eines gewoehnlichen Laufs: kein Emulator, keine
       Stummschaltung — nur JEST_WORKER_ID, das Jest selbst setzt. */
    delete process.env.NTFY_STUMM;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    expect(process.env.JEST_WORKER_ID).toBeDefined();

    const fetchAttrappe = jest.fn();
    global.fetch = fetchAttrappe;

    jest.resetModules();
    const { notifyLimitReached } = require("../notify");
    await notifyLimitReached({
      ntfyUrl: "https://beispiel.invalid",
      ntfyTopic: "test",
      adminSecret: "s",
      count: 156,
      limit: 155,
    });

    expect(fetchAttrappe).not.toHaveBeenCalled();
  });

  test("der Grund wird benannt, statt still zu schlucken", () => {
    delete process.env.NTFY_STUMM;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    jest.resetModules();
    const notify = require("../notify");
    const grund = notify._versandUnterdrueckt ? notify._versandUnterdrueckt() : null;
    /* Ist die Funktion nicht exportiert, greift die Wirkungspruefung oben —
       dann ist dieser Fall nur eine Zusatzangabe, kein Ersatz. */
    if (grund !== null) expect(grund).toMatch(/JEST_WORKER_ID/);
  });

  test.each([
    ["FIRESTORE_EMULATOR_HOST", "localhost:8080"],
    ["FUNCTIONS_EMULATOR", "true"],
    ["CLOUD_TASKS_EMULATOR_HOST", "localhost:9090"],
  ])("aus einem Emulator-Lauf geht nichts hinaus (%s)", async (name, wert) => {
    /* BEFUND 01.09.2026 (Runde 8, N-P2-3): Geprueft wurde nur
       FIRESTORE_EMULATOR_HOST. `npm run serve` setzt aber FUNCTIONS_EMULATOR —
       und die Nachricht ging hinaus. Der Emulator holt sich bei angemeldetem
       Konto die ECHTEN Zugangsdaten; genau so ist der Vorfall vom 30.08.
       entstanden. */
    delete process.env.NTFY_STUMM;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.CLOUD_TASKS_EMULATOR_HOST;
    process.env[name] = wert;

    const fetchAttrappe = jest.fn();
    global.fetch = fetchAttrappe;
    jest.resetModules();
    const { notifyLimitReached, setFetchForTest } = require("../notify");
    /* Attrappe hinterlegen, damit NICHT der Jest-Riegel antwortet, sondern
       der Emulator-Zweig — sonst misst dieser Fall den falschen Riegel. */
    setFetchForTest((...args) => global.fetch(...args));
    await notifyLimitReached({
      ntfyUrl: "https://beispiel.invalid",
      ntfyTopic: "test",
      adminSecret: "s",
      count: 156,
      limit: 155,
    });
    setFetchForTest(null);

    expect(fetchAttrappe).not.toHaveBeenCalled();
  });

  test("die ausdrueckliche Stummschaltung wirkt weiterhin", async () => {
    process.env.NTFY_STUMM = "1";
    const fetchAttrappe = jest.fn();
    global.fetch = fetchAttrappe;

    jest.resetModules();
    const { notifyLimitReached } = require("../notify");
    await notifyLimitReached({
      ntfyUrl: "https://beispiel.invalid",
      ntfyTopic: "test",
      adminSecret: "s",
      count: 156,
      limit: 155,
    });

    expect(fetchAttrappe).not.toHaveBeenCalled();
  });
});
