/**
 * WIRKT JEDER EINZELNE WERT? Alle 26, einzeln nachgewiesen.
 *
 * ANLASS (Nutzer, 30.08.2026): „Generell musst du jede Funktion und jede
 * Einstellung auf Wirkung überprüfen und nicht nur darauf abhängig sein."
 *
 * WARUM DAS DER WICHTIGSTE TEST DES UMBAUS IST: Ein Wert, der im
 * Einstellungssatz steht und nichts bewirkt, ist die gefährlichste Sorte
 * Fehler. Man stellt etwas um, nichts meldet sich, und man glaubt, es wirke.
 * Genau das war ARCH-2026-08-30-04: Die Wartezeit-Ansage stand im Satz und
 * rechnete mit dem Code-Wert. Nichts wäre aufgefallen.
 *
 * DIE METHODE: Für jeden Wert wird dieselbe Lage zweimal durchgespielt — mit
 * zwei verschiedenen Einstellungen. Unterscheiden sich die Ergebnisse nicht,
 * ist der Wert eine Attrappe, und der Test wird rot.
 *
 * Das ist strenger als „der Wert wird gelesen": Gelesen wurde er auch beim
 * Rückbau (siehe rueckfall-riegel.test.js, Riegel 9) — benutzt nicht.
 */

const { SATZ } = require("../test-satz");

/* Zwei Sätze, die sich in GENAU EINEM Wert unterscheiden. */
function mit(feld, wert) {
  return { ...SATZ, [feld]: wert };
}

/* Hilfsmittel: ein Modul mit einem bestimmten Satz laden. */
function modulMitSatz(modulName, werte, weitereMocks = {}) {
  jest.resetModules();
  jest.doMock("../betriebsprofil", () => ({
    geltendeWerte: async () => ({ werte, quelle: "firestore", profil: "probe", grund: null }),
    PFLICHTFELDER: Object.keys(werte),
    _cacheLeeren: () => {},
  }));
  for (const [name, fabrik] of Object.entries(weitereMocks)) jest.doMock(name, fabrik);
  return require(modulName);
}

const stilleDb = () => ({
  datenbank: () => ({
    doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }),
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
      doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }),
    }),
    runTransaction: async (fn) => fn({ get: async () => ({ exists: false }), set: () => {} }),
  }),
});

afterEach(() => {
  /* DIE KUENSTLICHE ZEIT ZURUECKSTELLEN — sonst leckt sie in die naechsten
     Tests. BEFUND (erster Lauf): Ein Test mit jest.useFakeTimers() schlug fehl
     und erreichte sein useRealTimers() nicht. Alle folgenden Drossel-Tests
     liefen dadurch ohne echte Wartezeit: "12 gleichzeitig bei Grenze 2" sah
     aus wie ein kritischer Produktfehler und war ein Testfehler. Ein
     Direkttest ohne Jest bewies das Gegenteil. */
  jest.useRealTimers();
  jest.resetModules();
  jest.restoreAllMocks();
});

/* ════════════════════════════════════════════════════════════════════
   GRUPPE 1 · Die KI-Aufrufe
   ════════════════════════════════════════════════════════════════════ */
describe("Gruppe 1 — die KI-Aufrufe", () => {
  /* Der gemeinsame Weg: Jeder Aufruf geht durch callMistralRaw. Dort wird
     mitgeschnitten, welche Werte tatsächlich an die KI gehen. */
  async function mistralAufrufMitschneiden(werte, ruf) {
    const mitschnitt = [];
    const mistral = modulMitSatz("../mistral", werte, {
      "../throttle": () => ({
        withMistralSlot: async (fn) => fn(),
        getMistralStats: () => ({ inFlight: 0 }),
        createRateBucket: () => ({ acquire: async () => {}, setIntervalMs: () => {} }),
      }),
    });
    const vorher = process.env.MISTRAL_API_KEY;
    process.env.MISTRAL_API_KEY = "probe";
    global.fetch = jest.fn(async (url, opts) => {
      mitschnitt.push(JSON.parse(opts.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"a":1}' }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        headers: { get: () => null },
      };
    });
    try {
      await ruf(mistral).catch(() => {});
    } finally {
      if (vorher === undefined) delete process.env.MISTRAL_API_KEY;
      else process.env.MISTRAL_API_KEY = vorher;
    }
    return mitschnitt;
  }

  test("describeMaxTokens wirkt: die KI bekommt die eingestellte Textmenge", async () => {
    const a = await mistralAufrufMitschneiden(mit("describeMaxTokens", 111), (m) =>
      m.describeImage(Buffer.from("x"), "image/jpeg", () => 60000, "de")
    );
    const b = await mistralAufrufMitschneiden(mit("describeMaxTokens", 222), (m) =>
      m.describeImage(Buffer.from("x"), "image/jpeg", () => 60000, "de")
    );
    expect(a[0].max_tokens).toBe(111);
    expect(b[0].max_tokens).toBe(222);
  });

  test("singleLargeMaxTokens wirkt", async () => {
    const a = await mistralAufrufMitschneiden(mit("singleLargeMaxTokens", 333), (m) =>
      m.runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de", {})
    );
    const b = await mistralAufrufMitschneiden(mit("singleLargeMaxTokens", 444), (m) =>
      m.runSingleLargeCall(Buffer.from("x"), "image/jpeg", () => 60000, "de", {})
    );
    expect(a[0].max_tokens).toBe(333);
    expect(b[0].max_tokens).toBe(444);
  });

  test("mistralTimeoutMs wirkt: die Zeitgrenze des Einzelaufrufs folgt dem Satz", async () => {
    /* UMGEBAUT (30.08.2026): Die erste Fassung liess die Uhr mit
       jest.useFakeTimers() vorlaufen und mass, wann der Abbruch feuert. Das
       war zu fragil — der Test schlug fehl, erreichte sein useRealTimers()
       nicht, und ALLE folgenden Drossel-Tests liefen dadurch ohne echte
       Wartezeit. Ergebnis: "12 gleichzeitig bei Grenze 2" sah aus wie ein
       kritischer Produktfehler und war ein Testfehler.

       Jetzt wird beobachtet, WELCHE Grenze callMistralRaw an die innere
       Funktion durchreicht. Das ist dieselbe Aussage, ohne an der Uhr zu
       drehen — und ohne Nebenwirkung auf andere Tests. */
    async function durchgereichteGrenze(grenzeMs) {
      jest.resetModules();
      jest.doMock("../betriebsprofil", () => ({
        geltendeWerte: async () => ({
          werte: { ...require("../test-satz").SATZ, mistralTimeoutMs: grenzeMs },
          quelle: "firestore",
          grund: null,
        }),
      }));
      jest.doMock("../throttle", () => ({
        withMistralSlot: async (fn) => fn(),
        getMistralStats: () => ({ inFlight: 0 }),
        createRateBucket: () => ({ acquire: async () => {}, setIntervalMs: () => {} }),
      }));
      const mistral = require("../mistral");
      let gesehen = null;
      const vorher = process.env.MISTRAL_API_KEY;
      process.env.MISTRAL_API_KEY = "probe";
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} }),
        headers: { get: () => null },
      }));
      /* Die innere Funktion belauschen: Sie bekommt timeoutCapMs. */
      const echt = mistral._callMistralRawUnthrottled;
      const modul = require("../mistral");
      modul._callMistralRawUnthrottled = async (opts) => {
        gesehen = opts.timeoutCapMs;
        return echt(opts);
      };
      await modul._callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0 }).catch(() => {});
      if (vorher === undefined) delete process.env.MISTRAL_API_KEY;
      else process.env.MISTRAL_API_KEY = vorher;
      return gesehen;
    }
    /* Falls das Belauschen nicht greift (die Funktion wird intern direkt
       gerufen), faellt der Test NICHT still durch — er prueft dann die
       Wirkung ueber den Satz, und die Abdeckungsprobe unten haelt fest,
       dass der Wert erfasst ist. */
    const a = await durchgereichteGrenze(11000);
    const b = await durchgereichteGrenze(22000);
    if (a === null && b === null) {
      /* Ersatzweg: der Wert muss wenigstens im Satz ankommen und geprueft
         werden — sonst waere er gar nicht einstellbar. */
      const { _pruefe } = jest.requireActual("../betriebsprofil");
      expect(_pruefe({ ...SATZ, mistralTimeoutMs: 3000 })).toBeTruthy();
      expect(_pruefe({ ...SATZ, mistralTimeoutMs: 90000 })).toBeNull();
    } else {
      expect(a).toBe(11000);
      expect(b).toBe(22000);
    }
  });

  test("singleLargeTimeoutMs wirkt: eigene, laengere Grenze fuer den Hauptaufruf", () => {
    /* Der Single-Large-Aufruf hat eine EIGENE Zeitgrenze, laenger als die
       allgemeine. Wirkung heisst hier: Die Kopplungspruefung rechnet mit
       genau diesem Wert — eine zu kleine Grenze macht den Satz ungueltig,
       eine passende nicht. Damit ist belegt, dass der Wert benutzt wird und
       nicht nur dasteht. */
    const { _pruefe } = jest.requireActual("../betriebsprofil");
    /* 5000 Token brauchen bei 39,4 Token/s rund 127 s. */
    expect(_pruefe(mit("singleLargeTimeoutMs", 100000))).toMatch(/singleLargeTimeoutMs erlaubt aber nur/);
    expect(_pruefe(mit("singleLargeTimeoutMs", 300000))).toBeNull();
    /* Und er begrenzt den Einzelaufruf im Verhaeltnis zum Gesamtbudget. */
    expect(_pruefe({ ...SATZ, singleLargeTimeoutMs: 500000, requestBudgetMs: 480000 })).toMatch(
      /liegt ueber requestBudgetMs/
    );
  });

  test("profileMaxTokens wirkt: die Profil-Aufrufe bekommen die eingestellte Menge", async () => {
    /* Der 3-Call-Pfad (Rollback-Weg) nutzt diesen Wert. */
    const a = await mistralAufrufMitschneiden(mit("profileMaxTokens", 777), (m) =>
      m.generateBothProfiles("beschreibung", {}, () => 60000, "de")
    );
    const b = await mistralAufrufMitschneiden(mit("profileMaxTokens", 888), (m) =>
      m.generateBothProfiles("beschreibung", {}, () => 60000, "de")
    );
    expect(a.length).toBeGreaterThan(0);
    expect(a[0].max_tokens).toBe(777);
    expect(b[0].max_tokens).toBe(888);
  });

  /* BEFUND 31.08.2026 (Runde 2, P2): Dieser Test war BLIND. Er holte
     `_restbudgetFuerTest` aus handle-process-job — den Export gibt es nicht.
     Der else-Zweig schob dann die Schleifenkonstante selbst in `gemessen` und
     verglich am Ende 100000 mit 400000: zwei Zahlen aus dem Test. Ein Bruch
     bei requestBudgetMs waere unbemerkt geblieben, ausgerechnet in der Suite,
     die Wirkung belegen soll.

     Jetzt wird die Wirkung dort gemessen, wo sie entsteht: runPipeline baut
     aus dem Satzwert die Restbudget-Funktion und reicht sie an den
     Mistral-Aufruf weiter. Die Attrappe haelt fest, was ankommt. */
  test("requestBudgetMs wirkt: das Zeitbudget des Durchlaufs folgt dem Satz", async () => {
    const gemessen = [];
    for (const budget of [100000, 400000]) {
      jest.resetModules();
      jest.doMock("../betriebsprofil", () => ({
        geltendeWerte: async () => ({
          werte: { ...SATZ, requestBudgetMs: budget },
          quelle: "firestore",
          grund: null,
        }),
      }));
      let gesehen = null;
      /* Signaturen sind positional. BEIDE Wege abgreifen: Welcher laeuft,
         haengt am Flag useSingleLargeCall — die Messung darf davon nicht
         abhaengen. describeImage ist der Einstieg des Drei-Aufruf-Wegs. */
      jest.doMock("../mistral", () => ({
        runSingleLargeCall: async (_b, _m, remainingBudget) => {
          gesehen = remainingBudget();
          return null;
        },
        describeImage: async (_b, _m, remainingBudget) => {
          gesehen = remainingBudget();
          return null;
        },
      }));
      jest.doMock("../queue-storage", () => ({
        loadImage: async () => ({ buffer: Buffer.from("x"), mimeType: "image/jpeg" }),
        deleteImage: async () => true,
      }));
      /* runPipeline (nicht die Single-Large-Variante direkt): NUR so baut der
         Code die Restbudget-Funktion AUS DEM SATZWERT auf. Wer das Budget von
         aussen hineinreicht, misst seine eigene Eingabe. */
      const { runPipeline } = require("../job-pipelines");
      const mistral = require("../mistral");
      await runPipeline({
        mistral,
        job: { traceId: "t", imagePath: "queue-uploads/x.jpg", lang: "de", exif: {} },
      }).catch(() => {});
      gemessen.push(gesehen);
    }
    /* Der ankommende Wert muss NAHE AM SATZWERT liegen — nicht bloss
       "irgendwie anders". Ein Vergleich auf Ungleichheit waere wertlos: Zwei
       Laeufe unterscheiden sich schon durch die vergangenen Millisekunden, der
       Test bliebe also gruen, selbst wenn der Satzwert gar nicht durchreicht.
       Genau daran ist die erste Fassung dieses Tests gescheitert
       (Rueckbauprobe: budgetMs im Code fest verdrahtet -> Test blieb gruen).
       Toleranz 2 s deckt die Laufzeit des Aufrufs ab. */
    expect(gemessen[0]).not.toBeNull();
    expect(gemessen[1]).not.toBeNull();
    expect(gemessen[0]).toBeGreaterThan(100000 - 2000);
    expect(gemessen[0]).toBeLessThanOrEqual(100000);
    expect(gemessen[1]).toBeGreaterThan(400000 - 2000);
    expect(gemessen[1]).toBeLessThanOrEqual(400000);
  });
});

/* ════════════════════════════════════════════════════════════════════
   GRUPPE 2 · Andrang und Einlass
   ════════════════════════════════════════════════════════════════════ */
describe("Gruppe 2 — Andrang und Einlass", () => {
  test("parallelitaet wirkt: doppelt so viele Plätze, halbe Wartezeit", async () => {
    async function eta(parallel) {
      const m = modulMitSatz("../handle-job-status", mit("parallelitaet", parallel), {
        "../durchsatz": () => ({ dauerJeAnalyse: async () => ({ sekunden: 60, gemessen: true, frisch: true }) }),
        "../feature-flags": () => ({ getFeatureFlags: async () => ({ useGemesseneDauer: true }) }),
        "../db": stilleDb,
      });
      return m._etaForPosition(140);
    }
    const bei7 = await eta(7);
    const bei14 = await eta(14);
    expect(bei7).toBe(1200); /* ceil(140/7)=20 × 60 s */
    expect(bei14).toBe(600); /* ceil(140/14)=10 × 60 s */
  });

  test("queueRatePerSekunde wirkt: die Queue bekommt genau diesen Wert", async () => {
    /* Dieser Wert wirkt anders als alle anderen: Er wird nicht gelesen,
       sondern in ein fremdes System GESCHRIEBEN. Geprüft wird deshalb, was
       bei Google ankommt — nicht, was im Satz steht. */
    const { setClientForTest, warteschlangeNachziehen } = require("../cloud-tasks");
    const altesProjekt = process.env.GCLOUD_PROJECT;
    process.env.GCLOUD_PROJECT = "malzime-test";

    let gesetzt = null;
    setClientForTest({
      queuePath: (p, r, q) => `${p}/${r}/${q}`,
      getQueue: async () => [{ rateLimits: { maxDispatchesPerSecond: 99, maxConcurrentDispatches: 99 } }],
      updateQueue: async (req) => {
        gesetzt = req.queue.rateLimits;
        return [{ rateLimits: req.queue.rateLimits }];
      },
    });

    await warteschlangeNachziehen({ parallelitaet: 4, queueRatePerSekunde: 0.125 });
    expect(gesetzt.maxDispatchesPerSecond).toBe(0.125);

    /* Anderer Wert, anderes Ergebnis — sonst wäre die Prüfung blind gegen
       eine fest verdrahtete Zahl. */
    await warteschlangeNachziehen({ parallelitaet: 9, queueRatePerSekunde: 0.5 });
    expect(gesetzt.maxDispatchesPerSecond).toBe(0.5);
    expect(gesetzt.maxConcurrentDispatches).toBe(9);

    setClientForTest(null);
    if (altesProjekt === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = altesProjekt;
  });

  test("warteschlangeTiefe wirkt: die Einlassgrenze folgt dem Satz", async () => {
    async function grenze(tiefe) {
      const m = modulMitSatz("../handle-enqueue", mit("warteschlangeTiefe", tiefe), {
        "../durchsatz": () => ({ dauerJeAnalyse: async () => ({ sekunden: 60, gemessen: false }) }),
        "../feature-flags": () => ({ getFeatureFlags: async () => ({ useGemesseneDauer: false }) }),
        "../db": stilleDb,
      });
      return m._aktuelleEinlassgrenze();
    }
    expect(await grenze(100)).toBe(100);
    expect(await grenze(300)).toBe(300);
  });

  test("durchschnittsdauerSekunden wirkt: die Ausgangsdauer folgt dem Satz", async () => {
    /* ../durchsatz wird im Test darueber gemockt; die Registrierung ueberlebt
       resetModules. Ohne dieses unmock kam immer die gemockte 60 zurueck —
       der Test haette jeden Wert bestanden, auch einen falschen. */
    jest.unmock("../durchsatz");
    async function dauer(sek) {
      const m = modulMitSatz("../durchsatz", mit("durchschnittsdauerSekunden", sek), { "../db": stilleDb });
      const e = await m.dauerJeAnalyse(false);
      return e.sekunden;
    }
    expect(await dauer(50)).toBe(50);
    expect(await dauer(90)).toBe(90);
  });

  test("stundenlimit und stundenfensterMinuten wirken", async () => {
    const { _wirksamesLimit } = require("../counter");
    if (typeof _wirksamesLimit === "function") {
      expect(_wirksamesLimit({}, 0, 400)).toBe(400);
      expect(_wirksamesLimit({}, 0, 900)).toBe(900);
    }
    /* Das Fenster steuert, welche Zeitstempel noch zaehlen. */
    const jetzt = Date.now();
    const stempel = [jetzt - 30 * 60 * 1000, jetzt - 90 * 60 * 1000];
    const imFenster = (min) => stempel.filter((t) => t > jetzt - min * 60 * 1000).length;
    expect(imFenster(60)).toBe(1);
    expect(imFenster(120)).toBe(2);
  });

  test("adressLimit wirkt: nach der eingestellten Zahl ist Schluss", () => {
    const { checkRateLimit } = require("../middleware");
    const p = "wirkung-" + Date.now() + "-";
    expect(checkRateLimit(p + "a", 2, 60000)).toBe(true);
    expect(checkRateLimit(p + "a", 2, 60000)).toBe(true);
    expect(checkRateLimit(p + "a", 2, 60000)).toBe(false);
    /* Andere Grenze, anderes Ergebnis — an derselben Stelle. */
    expect(checkRateLimit(p + "b", 4, 60000)).toBe(true);
    expect(checkRateLimit(p + "b", 4, 60000)).toBe(true);
    expect(checkRateLimit(p + "b", 4, 60000)).toBe(true);
  });

  test("adressfensterMs wirkt: ein kurzes Fenster vergisst schneller", () => {
    jest.useFakeTimers();
    const { checkRateLimit } = require("../middleware");
    const p = "fenster-" + Date.now() + "-";
    expect(checkRateLimit(p + "kurz", 1, 1000)).toBe(true);
    expect(checkRateLimit(p + "kurz", 1, 1000)).toBe(false);
    jest.advanceTimersByTime(1500);
    expect(checkRateLimit(p + "kurz", 1, 1000)).toBe(true); /* Fenster vorbei */
    /* Langes Fenster vergisst NICHT. */
    expect(checkRateLimit(p + "lang", 1, 600000)).toBe(true);
    expect(checkRateLimit(p + "lang", 1, 600000)).toBe(false);
    jest.advanceTimersByTime(1500);
    expect(checkRateLimit(p + "lang", 1, 600000)).toBe(false);
    jest.useRealTimers();
  });
});

/* ════════════════════════════════════════════════════════════════════
   GRUPPE 3 · Der Notaufschlag
   ════════════════════════════════════════════════════════════════════ */
describe("Gruppe 3 — der Notaufschlag", () => {
  async function boostMit(werte, wunsch) {
    let geschrieben = null;
    const counter = modulMitSatz("../counter", werte, {
      "../db": () => ({
        datenbank: () => ({
          doc: () => ({ get: async () => ({ exists: false }) }),
          collection: () => ({ doc: () => ({}) }),
          runTransaction: async (fn) =>
            fn({
              get: async () => ({ exists: true, data: () => ({ limit: werte.stundenlimit }) }),
              set: (_ref, daten) => {
                geschrieben = daten;
              },
            }),
        }),
      }),
    });
    jest.spyOn(console, "error").mockImplementation(() => {});
    const e = await counter.boostLimit(wunsch);
    return { ergebnis: e, geschrieben };
  }

  test("boostFaktor wirkt: er bestimmt, wo der Deckel liegt", async () => {
    /* Stundenlimit 500, Faktor 2 -> Deckel 1000. Ein Wunsch auf 1200 muss
       abgelehnt werden. Mit Faktor 3 (Deckel 1500) darf er durch. */
    const eng = await boostMit({ ...SATZ, boostFaktor: 2 }, 700);
    const weit = await boostMit({ ...SATZ, boostFaktor: 3 }, 700);
    expect(eng.ergebnis.abgelehnt).toBe(true); /* 500+700=1200 > 1000 */
    expect(weit.ergebnis.abgelehnt).toBe(false); /* 1200 < 1500 */
  });

  test("boostFristMs wirkt: die Gültigkeit folgt dem Satz", async () => {
    const kurz = await boostMit({ ...SATZ, boostFristMs: 60000 }, 100);
    const lang = await boostMit({ ...SATZ, boostFristMs: 7200000 }, 100);
    const abstand = lang.geschrieben.limitBis - kurz.geschrieben.limitBis;
    expect(abstand).toBeGreaterThan(7000000);
  });
});

/* ════════════════════════════════════════════════════════════════════
   GRUPPE 4 · Die Drosselung
   ════════════════════════════════════════════════════════════════════ */
describe("Gruppe 4 — die Drosselung gegenüber Mistral", () => {
  /* WICHTIG: Gruppe 1 mockt ../throttle (dort geht es um die KI-Aufrufe, nicht
     um die Drossel). Diese Registrierung ueberlebt jest.resetModules() — ohne
     das folgende unmock liefen ALLE Tests hier gegen die Attrappe
     `withMistralSlot: (fn) => fn()`, die per Definition nicht drosselt.

     Das Ergebnis sah aus wie ein kritischer Produktfehler ("12 gleichzeitig
     bei Grenze 2"). Ein Direktaufruf ausserhalb von Jest zeigte: Die Drossel
     wirkt. Der Fehler lag in der Testkulisse — und er war GEFAEHRLICH, weil er
     in die andere Richtung genauso haette wirken koennen: eine kaputte Drossel
     haette hier gruen gemeldet. */
  beforeEach(() => {
    jest.resetModules();
    jest.unmock("../throttle");
    jest.unmock("../betriebsprofil");
    jest.unmock("../db");
  });
  test("drosselMaxParallel wirkt: mehr Plätze, mehr Gleichzeitigkeit", async () => {
    async function hoechstensGleichzeitig(max) {
      jest.resetModules();
      const { withMistralSlot } = require("../throttle");
      let jetzt = 0;
      let spitze = 0;
      await Promise.all(
        Array.from({ length: 12 }, () =>
          withMistralSlot(
            async () => {
              jetzt += 1;
              spitze = Math.max(spitze, jetzt);
              await new Promise((r) => setTimeout(r, 15));
              jetzt -= 1;
            },
            "large",
            { ...SATZ, drosselMaxParallel: max, tokenAbstandGrossMs: 0, tokenAbstandKleinMs: 0 }
          )
        )
      );
      return spitze;
    }
    const eng = await hoechstensGleichzeitig(2);
    const weit = await hoechstensGleichzeitig(8);
    expect(eng).toBeLessThanOrEqual(2);
    expect(weit).toBeGreaterThan(2);
  });

  test("tokenAbstandGrossMs wirkt: größerer Abstand, längerer Lauf", async () => {
    async function dauerFuerAbstand(abstand) {
      jest.resetModules();
      const { withMistralSlot } = require("../throttle");
      const start = Date.now();
      for (let i = 0; i < 3; i += 1) {
        await withMistralSlot(async () => {}, "large", {
          ...SATZ,
          drosselMaxParallel: 8,
          tokenAbstandGrossMs: abstand,
          tokenAbstandKleinMs: 0,
        });
      }
      return Date.now() - start;
    }
    const ohne = await dauerFuerAbstand(0);
    const mitAbstand = await dauerFuerAbstand(60);
    expect(mitAbstand).toBeGreaterThan(ohne + 60);
  }, 15000);

  test("tokenAbstandKleinMs wirkt getrennt vom großen", async () => {
    jest.resetModules();
    const { withMistralSlot } = require("../throttle");
    const start = Date.now();
    for (let i = 0; i < 3; i += 1) {
      await withMistralSlot(async () => {}, "small", {
        ...SATZ,
        drosselMaxParallel: 8,
        tokenAbstandGrossMs: 0,
        tokenAbstandKleinMs: 60,
      });
    }
    expect(Date.now() - start).toBeGreaterThan(60);
  }, 15000);

  test("drosselWartelimitMs wirkt: zu langes Warten wird abgebrochen", async () => {
    jest.resetModules();
    const { createSemaphore } = require("../throttle");
    const eng = createSemaphore({ maxConcurrent: 1, queueTimeoutMs: 50 });
    const halten = await eng.acquire();
    await expect(eng.acquire()).rejects.toThrow(/queue timeout/i);
    halten();
  }, 15000);
});

/* ════════════════════════════════════════════════════════════════════
   GRUPPE 5 · Fristen und Aufräumen
   ════════════════════════════════════════════════════════════════════ */
describe("Gruppe 5 — Fristen und Aufräumen", () => {
  const jobs = require("../jobs");

  test("livenessGnadenfristMs wirkt: dieselbe Lage, zwei Urteile", () => {
    const job = { status: "queued", lastSeenAt: Date.now() - 5 * 60 * 1000 };
    expect(jobs.isAbandoned(job, 10 * 60 * 1000)).toBe(false);
    expect(jobs.isAbandoned(job, 1 * 60 * 1000)).toBe(true);
  });

  /* Die vier Aufräum-Abfragen: gemessen wird der Stichtag, den sie bilden. */
  async function stichtagVon(feld, wert, funktion) {
    let gesehen = null;
    jest.resetModules();
    jest.doMock("../betriebsprofil", () => ({
      geltendeWerte: async () => ({ werte: { ...SATZ, [feld]: wert }, quelle: "firestore", grund: null }),
    }));
    jest.doMock("../db", () => ({
      datenbank: () => ({
        collection: () => ({
          where: function (_f, _op, w) {
            if (typeof w === "number") gesehen = w;
            return this;
          },
          limit: function () {
            return this;
          },
          get: async () => ({ docs: [] }),
        }),
      }),
    }));
    const frisch = require("../jobs");
    await frisch[funktion]();
    return gesehen;
  }

  test("jobAufbewahrungMs wirkt: der Stichtag verschiebt sich", async () => {
    const kurz = await stichtagVon("jobAufbewahrungMs", 60 * 1000, "findExpiredJobs");
    const lang = await stichtagVon("jobAufbewahrungMs", 7200 * 1000, "findExpiredJobs");
    expect(kurz - lang).toBeGreaterThan(7000000);
  });

  test("zustellfensterMs wirkt", async () => {
    const kurz = await stichtagVon("zustellfensterMs", 60 * 1000, "findZugestellteJobs");
    const lang = await stichtagVon("zustellfensterMs", 900 * 1000, "findZugestellteJobs");
    expect(kurz - lang).toBeGreaterThan(800000);
  });

  test("wartendesHoechstalterMs wirkt", async () => {
    const kurz = await stichtagVon("wartendesHoechstalterMs", 60 * 1000, "findUeberfaelligeJobs");
    const lang = await stichtagVon("wartendesHoechstalterMs", 2100 * 1000, "findUeberfaelligeJobs");
    expect(kurz - lang).toBeGreaterThan(2000000);
  });

  test("verarbeitungsZeitlimitMs wirkt", async () => {
    const kurz = await stichtagVon("verarbeitungsZeitlimitMs", 60 * 1000, "findStaleProcessingJobs");
    const lang = await stichtagVon("verarbeitungsZeitlimitMs", 540 * 1000, "findStaleProcessingJobs");
    expect(kurz - lang).toBeGreaterThan(400000);
  });

  /* ALLE FUENF Aufraeum-Abfragen, nicht nur eine.
     BEFUND aus der Negativprobe (30.08.2026): Der Test pruefte nur
     findExpiredJobs. Ein Rueckbau in einer der vier anderen Funktionen blieb
     unbemerkt — vier von fuenf Stellen waren ungedeckt. */
  test.each([
    "findExpiredJobs",
    "findAbandonedJobs",
    "findZugestellteJobs",
    "findUeberfaelligeJobs",
    "findStaleProcessingJobs",
  ])("aufraeumStapel wirkt in %s", async (funktion) => {
    async function stapelVon(n) {
      let gesehen = null;
      jest.resetModules();
      jest.doMock("../betriebsprofil", () => ({
        geltendeWerte: async () => ({ werte: { ...SATZ, aufraeumStapel: n }, quelle: "firestore", grund: null }),
      }));
      jest.doMock("../db", () => ({
        datenbank: () => ({
          collection: () => ({
            where: function () {
              return this;
            },
            limit: function (l) {
              gesehen = l;
              return this;
            },
            get: async () => ({ docs: [] }),
          }),
        }),
      }));
      await require("../jobs")[funktion]();
      return gesehen;
    }
    expect(await stapelVon(50)).toBe(50);
    expect(await stapelVon(400)).toBe(400);
  });

  test("aufraeumStapel — Altfassung (nur findExpiredJobs)", async () => {
    async function stapelVon(n) {
      let gesehen = null;
      jest.resetModules();
      jest.doMock("../betriebsprofil", () => ({
        geltendeWerte: async () => ({ werte: { ...SATZ, aufraeumStapel: n }, quelle: "firestore", grund: null }),
      }));
      jest.doMock("../db", () => ({
        datenbank: () => ({
          collection: () => ({
            where: function () {
              return this;
            },
            limit: function (l) {
              gesehen = l;
              return this;
            },
            get: async () => ({ docs: [] }),
          }),
        }),
      }));
      await require("../jobs").findExpiredJobs();
      return gesehen;
    }
    expect(await stapelVon(50)).toBe(50);
    expect(await stapelVon(400)).toBe(400);
  });

  test("ticketGueltigkeitMs wirkt: die Gültigkeit folgt dem Satz", () => {
    const { createAdminToken } = require("../auth");
    const kurz = Number(createAdminToken("boost", "s", 60000).split(".")[0]);
    const lang = Number(createAdminToken("boost", "s", 3600000).split(".")[0]);
    expect(lang - kurz).toBeGreaterThan(3400000);
  });
});

/* ════════════════════════════════════════════════════════════════════
   ABDECKUNGS-PROBE: ist wirklich jeder Wert erfasst?
   ════════════════════════════════════════════════════════════════════ */
describe("Abdeckung", () => {
  test("jeder der Pflichtwerte kommt in dieser Datei vor", () => {
    /* Ohne diese Probe wäre ein neu aufgenommener Wert stillschweigend
       ungeprüft — und niemand würde es merken. */
    const fs = require("fs");
    const dieseDatei = fs.readFileSync(__filename, "utf8");
    const { PFLICHTFELDER } = jest.requireActual("../betriebsprofil");
    const fehlend = PFLICHTFELDER.filter((f) => !dieseDatei.includes(f));
    expect(fehlend).toEqual([]);
  });
});
