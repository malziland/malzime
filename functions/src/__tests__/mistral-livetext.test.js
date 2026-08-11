/* Tests fuer den Live-Text-Strom (v3.0 Phase 1) in mistral.js.

   Zwei Ebenen:
   1. `_extrahiereLiveText` — der Escape-bewusste Extraktor, der aus einem
      JSON-Praefix den bereits KOMPLETT angekommenen Teil des
      profileText-Werts zieht. Er ist die wichtigste Schutzschicht: Chunk-
      Grenzen liegen laut Phase-0-Messung mitten in Woertern, mitten in
      JSON-Escapes und mitten in Mehrbyte-Zeichen.
   2. Der SSE-Stream-Leser in `callMistralRaw` — mit einem Mock-fetch, dessen
      ReadableStream die Antwort in fiese Stuecke zerteilt (Byte-Grenzen
      mitten in UTF-8-Sequenzen, Delta-Grenzen mitten in Escapes). Der
      Endtext muss byte-identisch zum Nicht-Stream-Pfad sein. */

const mistral = require("../mistral");
const { setFetchForTest, _callMistralRaw, _extrahiereLiveText, _setLiveIntervalMsForTest, runSingleLargeCall } =
  mistral;
const { _setRateIntervalMs, _resetRateBucket } = require("../throttle");

const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;

beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  /* Token-Bucket deaktivieren, sonst serialisiert er die Calls auf 1 RPS. */
  _setRateIntervalMs(0);
  _resetRateBucket();
  /* Live-Extraktion bei jedem Netz-Chunk statt alle 2 s — nur so sind die
     wachsenden Praefixe im Test beobachtbar. */
  _setLiveIntervalMsForTest(0);
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
  setFetchForTest(null);
  _setLiveIntervalMsForTest(null);
});

afterAll(() => {
  _setRateIntervalMs(1000);
  _resetRateBucket();
});

/* ── 1. Extraktor: _extrahiereLiveText ───────────────────────────── */

describe("extrahiereLiveText — Feld noch nicht begonnen", () => {
  test("liefert null, solange der Schluessel fehlt", () => {
    expect(_extrahiereLiveText('{"subject": "PERSON", "hard_facts": {"alter')).toBeNull();
  });

  test("liefert null, wenn nur der Schluessel da ist (kein Doppelpunkt, kein Wert)", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText"')).toBeNull();
  });

  test("liefert null nach Doppelpunkt ohne oeffnendes Anfuehrungszeichen", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText":')).toBeNull();
    expect(_extrahiereLiveText('{"standard": {"profileText": ')).toBeNull();
  });

  test("liefert null bei Nicht-String-Eingabe", () => {
    expect(_extrahiereLiveText(null)).toBeNull();
    expect(_extrahiereLiveText(undefined)).toBeNull();
    expect(_extrahiereLiveText(42)).toBeNull();
  });
});

describe("extrahiereLiveText — normale Faelle", () => {
  test("leerer String, sobald das oeffnende Anfuehrungszeichen da ist", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText": "')).toBe("");
  });

  test("Praefix endet mitten im Wort — der bisherige Text kommt zurueck", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText": "Du bist neugier')).toBe("Du bist neugier");
  });

  test("Whitespace/Zeilenumbruch zwischen Schluessel, Doppelpunkt und Wert", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText" :\n  "Du bist')).toBe("Du bist");
  });

  test("abgeschlossener Wert (unescaptes Anfuehrungszeichen) — Text endet dort", () => {
    const praefix = '{"standard": {"profileText": "Du bist neugierig.", "categories": {"inter';
    expect(_extrahiereLiveText(praefix)).toBe("Du bist neugierig.");
  });

  test("der ERSTE Treffer zaehlt — das ist das Standard-Profil", () => {
    const praefix = '{"standard": {"profileText": "Standard-Text."}, "beast": {"profileText": "Beast-Text."}}';
    expect(_extrahiereLiveText(praefix)).toBe("Standard-Text.");
  });

  test("Umlaute und Emojis als rohe Zeichen bleiben erhalten", () => {
    expect(_extrahiereLiveText('{"profileText": "Grüße aus Österreich 🎉 und weiter')).toBe(
      "Grüße aus Österreich 🎉 und weiter"
    );
  });
});

describe("extrahiereLiveText — Escapes", () => {
  test("Escapes werden zu echten Zeichen dekodiert", () => {
    const praefix = '{"profileText": "Er sagt \\"Hallo\\" und macht\\neinen Umbruch\\tmit Tab und \\\\ Backslash';
    expect(_extrahiereLiveText(praefix)).toBe('Er sagt "Hallo" und macht\neinen Umbruch\tmit Tab und \\ Backslash');
  });

  test("\\uXXXX-Escapes werden aufgeloest — auch Emoji-Surrogatpaare", () => {
    const praefix = '{"profileText": "Umlaut \\u00e4, Gedankenstrich \\u2014, Emoji \\ud83d\\ude00!"';
    expect(_extrahiereLiveText(praefix)).toBe("Umlaut ä, Gedankenstrich —, Emoji 😀!");
  });

  test('Praefix endet mitten in \\" — der nackte Backslash wird abgeschnitten', () => {
    expect(_extrahiereLiveText('{"profileText": "Zitat: \\')).toBe("Zitat: ");
  });

  test("Praefix endet mitten in \\u00 — das halbe Escape wird abgeschnitten", () => {
    expect(_extrahiereLiveText('{"profileText": "Etwa 25\\u00')).toBe("Etwa 25");
    expect(_extrahiereLiveText('{"profileText": "Etwa 25\\u')).toBe("Etwa 25");
    expect(_extrahiereLiveText('{"profileText": "Etwa 25\\u00b')).toBe("Etwa 25");
  });

  test("ein komplettes \\uXXXX am Praefix-Ende bleibt erhalten", () => {
    expect(_extrahiereLiveText('{"profileText": "25\\u00b0')).toBe("25°");
  });

  test("einsame hohe Surrogathälfte am Ende (halbes Emoji) wird abgeschnitten", () => {
    expect(_extrahiereLiveText('{"profileText": "Feier \\ud83d')).toBe("Feier ");
  });

  test("ein escaptes Anfuehrungszeichen beendet den Wert NICHT", () => {
    expect(_extrahiereLiveText('{"profileText": "Er sagt \\"Servus\\" und geht')).toBe('Er sagt "Servus" und geht');
  });
});

/* ── 2. Stream-Leser: SSE-Mock mit fiesen Zerteilungen ──────────── */

/* Handgebauter Modell-Output mit allem, was wehtut: escaptes
   Anfuehrungszeichen, \uXXXX-Umlaut, Emoji als Surrogatpaar-Escape UND
   rohes Mehrbyte-Zeichen. */
const PROFIL_ROH = 'Du bist \\"neugierig\\" \\u2014 mit \\u00e4 und \\ud83d\\ude00, dazu ü direkt.';
const PROFIL_KLARTEXT = 'Du bist "neugierig" — mit ä und 😀, dazu ü direkt.';
const MODELL_JSON =
  '{"subject": "PERSON", "standard": {"profileText": "' +
  PROFIL_ROH +
  '", "weiter": "x"}, "beast": {"profileText": "Beast."}}';

/* Zerteilt einen Text an festen Byte-/Zeichen-Positionen PLUS an allen
   uebergebenen Extra-Positionen — so liegen Grenzen garantiert mitten in
   Escapes. */
function zerteile(text, breite, extraPositionen = []) {
  const schnitte = new Set(extraPositionen.filter((p) => p > 0 && p < text.length));
  for (let i = breite; i < text.length; i += breite) schnitte.add(i);
  const sortiert = [...schnitte].sort((a, b) => a - b);
  const teile = [];
  let start = 0;
  for (const s of sortiert) {
    teile.push(text.slice(start, s));
    start = s;
  }
  teile.push(text.slice(start));
  return teile.filter((t) => t.length > 0);
}

/* Baut aus Delta-Stuecken den kompletten SSE-Text (gemessenes Format):
   `data: {...}`-Zeilen, usage im letzten Chunk, Abschluss `data: [DONE]`. */
function baueSseText(deltas) {
  const zeilen = deltas.map(
    (stueck) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: stueck } }] })}\n\n`
  );
  zeilen.push(
    `data: ${JSON.stringify({
      choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4000, completion_tokens: 2000, prompt_tokens_details: { cached_tokens: 3600 } },
    })}\n\n`
  );
  zeilen.push("data: [DONE]\n\n");
  return zeilen.join("");
}

/* Antwort-Objekt mit ReadableStream, der die SSE-Bytes in kleinen Haeppchen
   liefert — 7-Byte-Chunks zerschneiden ü/😀 garantiert mitten in der
   UTF-8-Sequenz (TextDecoder {stream:true} muss das abfangen). */
function sseAntwort(sseText, byteChunkGroesse = 7) {
  const bytes = new TextEncoder().encode(sseText);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += byteChunkGroesse) {
    chunks.push(bytes.slice(i, i + byteChunkGroesse));
  }
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    }),
  };
}

/* Delta-Grenzen exakt an Escape-Grenzen legen: mitten in \" (nach dem
   Backslash) und mitten in ä (nach "\u00"). */
function fieseDeltas() {
  const keyIdx = MODELL_JSON.indexOf('"profileText"');
  const posInEscape = MODELL_JSON.indexOf('\\"', keyIdx) + 1;
  const posInUnicode = MODELL_JSON.indexOf("\\u00e4") + 3;
  return zerteile(MODELL_JSON, 9, [posInEscape, posInUnicode]);
}

describe("callMistralRaw — Stream-Modus (Mock-SSE)", () => {
  test("Endtext ist byte-identisch zur Nicht-Stream-Antwort, usage kommt aus dem letzten Chunk", async () => {
    setFetchForTest(async () => sseAntwort(baueSseText(fieseDeltas())));
    const mitStream = await _callMistralRaw({
      model: "mistral-large-2512",
      messages: [{ role: "user", content: "x" }],
      maxTokens: 100,
      temperature: 0.5,
      forceJSON: true,
      onLiveText: () => {},
    });

    setFetchForTest(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: MODELL_JSON }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4000, completion_tokens: 2000, prompt_tokens_details: { cached_tokens: 3600 } },
      }),
    }));
    const ohneStream = await _callMistralRaw({
      model: "mistral-large-2512",
      messages: [{ role: "user", content: "x" }],
      maxTokens: 100,
      temperature: 0.5,
      forceJSON: true,
    });

    expect(mitStream.text).toBe(MODELL_JSON);
    expect(mitStream.text).toBe(ohneStream.text);
    expect(mitStream.finishReason).toBe("stop");
    expect(mitStream.promptTokens).toBe(4000);
    expect(mitStream.outputTokens).toBe(2000);
    expect(mitStream.cachedTokens).toBe(3600);
  });

  test("onLiveText wird mit wachsenden Praefixen gerufen und endet beim vollen Klartext", async () => {
    setFetchForTest(async () => sseAntwort(baueSseText(fieseDeltas())));
    const wellen = [];
    await _callMistralRaw({
      model: "x",
      messages: [],
      maxTokens: 100,
      temperature: 0,
      onLiveText: (text) => wellen.push(text),
    });

    expect(wellen.length).toBeGreaterThanOrEqual(2);
    /* Jede Welle setzt die vorige fort — nie ein Ruecksprung, nie Muell. */
    for (let i = 1; i < wellen.length; i++) {
      expect(wellen[i].startsWith(wellen[i - 1])).toBe(true);
    }
    /* Die erste Welle ist echt unvollstaendig, die letzte der volle Text. */
    expect(wellen[0].length).toBeLessThan(PROFIL_KLARTEXT.length);
    expect(wellen[wellen.length - 1]).toBe(PROFIL_KLARTEXT);
    /* Keine Welle enthaelt rohe JSON-Escapes — alles ist dekodiert. */
    for (const w of wellen) {
      expect(w).not.toContain('\\"');
      expect(w).not.toContain("\\u");
    }
  });

  test("Fehler im Callback lassen den Aufruf NIE scheitern (sync-Throw und async-Rejection)", async () => {
    setFetchForTest(async () => sseAntwort(baueSseText(fieseDeltas())));
    let n = 0;
    const result = await _callMistralRaw({
      model: "x",
      messages: [],
      maxTokens: 100,
      temperature: 0,
      onLiveText: () => {
        n += 1;
        if (n % 2 === 0) return Promise.reject(new Error("async kaputt"));
        throw new Error("sync kaputt");
      },
    });
    expect(n).toBeGreaterThan(0); /* der Callback wurde wirklich gerufen */
    expect(result.text).toBe(MODELL_JSON); /* und der Aufruf lief sauber durch */
  });

  test("ohne onLiveText steht KEIN stream im Request-Body (heutiger Pfad, Flag-Garantie)", async () => {
    let body = null;
    setFetchForTest(async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: {} }),
      };
    });
    await _callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0 });
    expect(body).not.toHaveProperty("stream");
  });

  test("mit onLiveText steht stream:true im Request-Body — response_format bleibt erhalten", async () => {
    let body = null;
    setFetchForTest(async (_url, init) => {
      body = JSON.parse(init.body);
      return sseAntwort(baueSseText(["ok"]));
    });
    await _callMistralRaw({
      model: "x",
      messages: [],
      maxTokens: 1,
      temperature: 0,
      forceJSON: true,
      onLiveText: () => {},
    });
    expect(body.stream).toBe(true);
    /* Phase-0-Messung: stream + response_format + cache_key vertragen sich. */
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  test("HTTP-Fehler im Stream-Modus laufen durch die bestehende Fehlerbehandlung", async () => {
    setFetchForTest(async () => ({ ok: false, status: 500, text: async () => "kaputt" }));
    await expect(
      _callMistralRaw({ model: "x", messages: [], maxTokens: 1, temperature: 0, onLiveText: () => {} })
    ).rejects.toMatchObject({ status: 500 });
  });
});

/* ── 3. Durchreichung in runSingleLargeCall ─────────────────────── */

describe("runSingleLargeCall — Live-Text-Durchreichung", () => {
  const REQUIRED_KEYS = [
    "alter_geschlecht",
    "herkunft",
    "einkommen",
    "bildung",
    "beziehungsstatus",
    "interessen",
    "persoenlichkeit",
    "charakterzuege",
    "politisch",
    "gesundheit",
    "kaufkraft",
    "verletzlichkeit",
    "werbeprofil",
  ];

  function alleKarten(prefix) {
    const out = {};
    for (const k of REQUIRED_KEYS) out[k] = { label: k, value: `${prefix} ${k}`, confidence: 0.8 };
    return out;
  }

  function vollstaendigeAntwort() {
    return {
      subject: "PERSON",
      visible_text: "",
      hard_facts: { alter_geschlecht: "männlich, ~38", herkunft: "mitteleuropäisch" },
      ad_targeting: ["A"],
      manipulation_triggers: ["T"],
      standard: { profileText: "Du bist sachlich beschrieben.", categories: alleKarten("Standard") },
      beast: { profileText: "Du bist zynisch beschrieben.", categories: alleKarten("Beast") },
    };
  }

  test("opts.onLiveText schaltet den Stream ein und liefert Praefixe des Standard-profileText", async () => {
    const antwortJson = JSON.stringify(vollstaendigeAntwort());
    let body = null;
    setFetchForTest(async (_url, init) => {
      body = JSON.parse(init.body);
      return sseAntwort(baueSseText(zerteile(antwortJson, 40)));
    });

    const wellen = [];
    const result = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 60000, "de", {
      onLiveText: (text) => wellen.push(text),
    });

    expect(body.stream).toBe(true);
    /* Das Endergebnis ist das gewohnte { normal, boost }-Shape ... */
    expect(result.normal).toBeTruthy();
    expect(result.boost).toBeTruthy();
    expect(result.normal.profileText).toBe("Du bist sachlich beschrieben.");
    /* ... und die Wellen sind Praefixe des STANDARD-Texts (erster Treffer). */
    expect(wellen.length).toBeGreaterThanOrEqual(1);
    for (const w of wellen) {
      expect("Du bist sachlich beschrieben.".startsWith(w)).toBe(true);
    }
  });

  test("ohne opts.onLiveText bleibt der Request bitgenau der heutige (kein stream)", async () => {
    let body = null;
    setFetchForTest(async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(vollstaendigeAntwort()) }, finish_reason: "stop" }],
          usage: {},
        }),
      };
    });
    const result = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 60000, "de");
    expect(result.normal).toBeTruthy();
    expect(body).not.toHaveProperty("stream");
  });
});
