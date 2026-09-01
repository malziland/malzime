/* WAS PASSIERT, WENN DER EINSTELLUNGSSATZ FEHLT?
 *
 * Diese Datei ist die Antwort auf einen berechtigten Einwand (Nutzer,
 * 30.08.2026): "Gehören die Tests nicht wirklich angepasst, so bleibt es ja
 * ein Flickwerk?"
 *
 * Alle anderen Tests stellen den Satz über einen zentralen Mock bereit — sie
 * prüfen etwas anderes und brauchen ihn nur als Kulisse. Damit prüfte
 * anschließend aber KEIN Test mehr den Fall, der beim Live-Gang der
 * gefährlichste ist: Der Satz fehlt, ist unvollständig oder wird abgelehnt.
 *
 * Hier wird deshalb der Reihe nach JEDER Weg durchgegangen, der Betriebswerte
 * braucht. Erwartet wird immer dasselbe:
 *
 *   1. Es läuft NICHT still mit erfundenen Zahlen weiter.
 *   2. Es stürzt NICHT unkontrolliert ab.
 *   3. Der Grund steht im Protokoll, damit die Alarmierung greift.
 *
 * Punkt 1 ist der eigentliche Zweck des Umbaus: Vorher hätte jeder dieser
 * Wege auf eine Konstante im Code zurückgegriffen — und niemand hätte gemerkt,
 * dass die Einstellung gar nicht ankam.
 */

/* KEINE `if (typeof … === "function")`-Abfragen in dieser Datei.
   Ein Test, der sich selbst überspringt, wenn die Funktion fehlt, meldet grün
   und misst nichts — genau das ist hier am 30.08.2026 einmal passiert
   (`_etaForPosition` war nicht exportiert). Fehlt eine Funktion, soll der Test
   ROT werden, nicht schweigen.

   KEIN Satz. Genau das ist der Prüfgegenstand. */
jest.mock("../betriebsprofil", () => ({
  geltendeWerte: async () => ({
    werte: null,
    quelle: "fehlt",
    profil: null,
    grund: 'Profil "t1-normal" abgelehnt: singleLargeMaxTokens fehlt',
  }),
  _cacheLeeren: () => {},
}));

const machDoc = () => ({ get: jest.fn(async () => ({ exists: false, data: () => ({}) })) });
jest.mock("../db", () => ({
  datenbank: () => ({
    doc: machDoc,
    collection: () => ({
      where: function () {
        return this;
      },
      limit: function () {
        return this;
      },
      orderBy: function () {
        return this;
      },
      get: async () => ({ docs: [], empty: true }),
      count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
      doc: machDoc,
    }),
    runTransaction: async (fn) => fn({ get: async () => ({ exists: false }), set: () => {} }),
  }),
}));

describe("Ohne Einstellungssatz — kein Weg rechnet mit erfundenen Zahlen", () => {
  let fehlerZeilen;
  beforeEach(() => {
    fehlerZeilen = [];
    jest.spyOn(console, "error").mockImplementation((z) => fehlerZeilen.push(String(z)));
    jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  /* ── Die Aufräum-Wege ─────────────────────────────────────────────────
     Der Reaper löscht Bilder und Ergebnisse. Ohne Satz kennt er keine Frist.
     Früher hätte er die Konstante aus dem Code genommen — und damit
     möglicherweise eine ANDERE Frist angewandt als die eingestellte. */
  const jobs = require("../jobs");
  test.each([
    ["findAbandonedJobs", () => jobs.findAbandonedJobs()],
    ["findExpiredJobs", () => jobs.findExpiredJobs()],
    ["findZugestellteJobs", () => jobs.findZugestellteJobs()],
    ["findUeberfaelligeJobs", () => jobs.findUeberfaelligeJobs()],
    ["findStaleProcessingJobs", () => jobs.findStaleProcessingJobs()],
  ])("%s bricht ab, statt mit einer Ersatzfrist zu löschen", async (_name, aufruf) => {
    await expect(aufruf()).rejects.toMatchObject({ code: "config_missing" });
  });

  test("markFailedIfStale bricht ab, statt einen Job nach falscher Frist zu töten", async () => {
    const job = { id: "x", status: "processing", startedAt: Date.now() - 60 * 60 * 1000 };
    await expect(jobs.markFailedIfStale(job)).rejects.toMatchObject({ code: "config_missing" });
  });

  /* ── Die Einlasskontrolle ─────────────────────────────────────────────
     Ohne Satz läuft keine Analyse. Die ehrliche Einlassgrenze ist deshalb
     null — NICHT die alte Konstante, die 155 Leute hereingelassen hätte,
     deren Aufträge dann alle scheitern. */
  test("Einlassgrenze ist null, nicht die alte Konstante", async () => {
    const { _aktuelleEinlassgrenze } = require("../handle-enqueue");
    expect(typeof _aktuelleEinlassgrenze).toBe("function");
    expect(await _aktuelleEinlassgrenze()).toBe(0);
  });

  /* ── Die Wartezeit-Ansage ─────────────────────────────────────────────
     Lieber keine Zeitangabe als eine falsche. Der Client zeigt dann die
     Position, die immer stimmt. */
  test("Wartezeit-Ansage sagt 'weiss nicht', statt falsch zu rechnen", async () => {
    const { _etaForPosition } = require("../handle-job-status");
    expect(typeof _etaForPosition).toBe("function");
    expect(await _etaForPosition(10)).toBeNull();
  });

  /* ── Der Notaufschlag ─────────────────────────────────────────────────
     Fail-closed: kein Satz, kein Boost. Sonst liesse sich die Kostenbremse
     genau dann anheben, wenn niemand weiss, wie hoch sie steht. */
  test("Boost wird abgelehnt und meldet den Grund", async () => {
    const { boostLimit } = require("../counter");
    const ergebnis = await boostLimit(100);
    expect(ergebnis.abgelehnt).toBe(true);
    expect(fehlerZeilen.join(" ")).toContain("boost-ohne-einstellungssatz");
  });

  /* ── Die Wachen ───────────────────────────────────────────────────────
     Eine Wache, die gegen eine erfundene Grenze misst, ist schlimmer als
     keine: Sie meldet grün und niemand schaut nach. */
  test("Laufzeit-Wache bewertet nicht und sagt warum", async () => {
    const { pruefeLaufzeit } = require("../laufzeit-wache");
    const e = await pruefeLaufzeit({ melder: async () => {} });
    expect(e.grund).toBe("kein-einstellungssatz");
    expect(fehlerZeilen.join(" ")).toContain("laufzeit-wache");
  });

  test("Kapazitäts-Wache gleicht nicht ab und sagt warum", async () => {
    const { pruefeKapazitaet } = require("../kapazitaets-wache");
    const e = await pruefeKapazitaet({ melder: async () => {}, holeQueue: async () => 7 });
    expect(e.grund).toBe("kein-einstellungssatz");
  });

  /* ── Die Verwaltungs-Knöpfe ───────────────────────────────────────────
     Ein Token ohne bekannte Gültigkeitsdauer ist ein Sicherheitsproblem. */
  test("Admin-Token wird ohne Gültigkeitsdauer gar nicht erst erzeugt", () => {
    const { createAdminToken } = require("../auth");
    expect(() => createAdminToken("boost", "geheim")).toThrow(/ticketGueltigkeitMs/);
  });

  test("ntfy-Mitteilung geht ohne Satz nicht mit toten Knöpfen raus", async () => {
    const { notifyLimitReached, setFetchForTest } = require("../notify");
    global.fetch = jest.fn();
    /* Die Attrappe wird hinterlegt, damit der Weg bis zum Satz-Check LÄUFT.
       Ohne sie bräche schon der Test-Riegel ab (Runde 4, E-3) — dann bewiese
       dieser Fall nur, dass Jest nichts nach draußen lässt, statt dessen, was
       er zusagt: dass ohne Einstellungssatz keine Mitteilung mit toten
       Knöpfen hinausgeht und der Grund im Protokoll steht. */
    setFetchForTest((...args) => global.fetch(...args));
    await notifyLimitReached({
      ntfyUrl: "https://example.invalid",
      ntfyTopic: "t",
      adminSecret: "s",
      count: 1,
      limit: 1,
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(fehlerZeilen.join(" ")).toContain("kein Einstellungssatz");
    setFetchForTest(null);
  });

  /* ── Die Drossel ──────────────────────────────────────────────────────
     Ohne Werte drosselt sie auf das Engste, statt ungebremst zu feuern.
     Falsch herum wäre es teuer: ein Sturm gegen das Limit des Anbieters. */
  test("Drossel bleibt eng, statt ungebremst zu feuern", async () => {
    const { withMistralSlot, getMistralStats } = require("../throttle");
    let gleichzeitig = 0,
      hoechstens = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        withMistralSlot(
          async () => {
            gleichzeitig += 1;
            hoechstens = Math.max(hoechstens, gleichzeitig);
            await new Promise((r) => setTimeout(r, 5));
            gleichzeitig -= 1;
          },
          "large",
          undefined
        )
      )
    );
    expect(hoechstens).toBeLessThanOrEqual(6);
    expect(getMistralStats()).toBeDefined();
  });

  /* ── Die globale Kostenbremse ─────────────────────────────────────────
     BEFUND 01.09.2026 (Runde 7): Diese Datei beansprucht im Kopf, "der Reihe
     nach JEDEN Weg" zu pruefen — `checkAndIncrement` fehlte. Genau dort lief
     die Bremse ohne Satz in einen Zugriffsfehler auf `null` und fiel
     fail-open auf "erlaubt", mit einer Meldung, die nur "Fehler" sagte statt
     "kein Satz". Der fehlende Testfall WAR die Wurzel des Befunds. */
  test("Die Kostenbremse benennt den Zustand, statt ihn als Fehler zu tarnen", async () => {
    const fehlerSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { checkAndIncrement } = require("../counter");
    const e = await checkAndIncrement();
    /* Erst auslesen, dann zuruecksetzen: mockRestore() loescht die
       aufgezeichneten Aufrufe. */
    const gemeldet = fehlerSpy.mock.calls.map((c) => String(c[0])).join(" ");
    fehlerSpy.mockRestore();

    /* Sie laesst durch — ohne Satz laeuft ohnehin keine Analyse, und ein
       geschlossenes Tor waere hier keine Sicherheit, sondern ein zweiter
       Ausfall. Aber sie sagt WARUM. */
    /* BEFUND 01.09.2026 (Mutationsprobe): Genau diese Zusicherung fehlte —
       geprueft wurden Grund und Limit, nicht die ENTSCHEIDUNG. `allowed: true`
       liess sich zu `false` aendern, ohne dass ein Test rot wurde. Damit war
       die bewusste Abwaegung (durchlassen statt sperren, weil ohne Satz
       ohnehin keine Analyse laeuft) von nichts festgehalten — sie haette
       jederzeit unbemerkt kippen koennen, und der Einlass waere doppelt
       gesperrt gewesen. */
    expect(e.allowed).toBe(true);
    expect(e.grund).toBe("kein-einstellungssatz");
    expect(e.limit).toBeNull();
    expect(gemeldet).toMatch(/kein-einstellungssatz/);
    expect(gemeldet).toMatch(/ERROR/);
  });

  /* ── Der Analyse-Pfad selbst ──────────────────────────────────────────
     Das Kernversprechen des Umbaus: keine Analyse ohne gültige Werte. */
  test("Die Analyse startet gar nicht erst", async () => {
    const mistral = require("../mistral");
    expect(typeof mistral.runSingleLargeCall).toBe("function");
    await expect(
      mistral.runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 10000, "de", {})
    ).rejects.toMatchObject({ code: "config_missing" });
  });
});
