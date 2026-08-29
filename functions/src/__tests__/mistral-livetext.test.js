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

/* Seit Phase 3 liefert der Extraktor BEIDE Texte: { standard, beast } —
   seit KA-11 (Kurzaudit 2026-08-12) VERANKERT am jeweiligen Modus-Schluessel
   ("standard"/"beast") statt an der blossen Reihenfolge der Vorkommen;
   jeweils null, solange der Wert noch nicht begonnen hat. */
/* FEATURE-2026-08-29-01: Die Rueckgabe traegt seit den Live-Karten zwei Felder
   mehr. Bewusst weiter mit `toEqual` auf die VOLLE Struktur geprueft statt auf
   einzelne Felder — sonst faellt kuenftig nicht mehr auf, wenn ein Feld
   unbemerkt dazukommt oder verschwindet. */
const NICHTS = { standard: null, beast: null, kartenStandard: [], kartenBeast: [] };

describe("extrahiereLiveText — Feld noch nicht begonnen", () => {
  test("liefert beide null, solange der Schluessel fehlt", () => {
    expect(_extrahiereLiveText('{"subject": "PERSON", "hard_facts": {"alter')).toEqual(NICHTS);
  });

  test("liefert beide null, wenn nur der Schluessel da ist (kein Doppelpunkt, kein Wert)", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText"')).toEqual(NICHTS);
  });

  test("liefert beide null nach Doppelpunkt ohne oeffnendes Anfuehrungszeichen", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText":')).toEqual(NICHTS);
    expect(_extrahiereLiveText('{"standard": {"profileText": ')).toEqual(NICHTS);
  });

  test("liefert beide null bei Nicht-String-Eingabe", () => {
    expect(_extrahiereLiveText(null)).toEqual(NICHTS);
    expect(_extrahiereLiveText(undefined)).toEqual(NICHTS);
    expect(_extrahiereLiveText(42)).toEqual(NICHTS);
  });
});

describe("extrahiereLiveText — normale Faelle", () => {
  test("leerer Standard-String, sobald das oeffnende Anfuehrungszeichen da ist", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText": "')).toEqual({
      standard: "",
      beast: null,
      kartenStandard: [],
      kartenBeast: [],
    });
  });

  test("nur standard begonnen: Praefix endet mitten im Wort, beast bleibt null", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText": "Du bist neugier')).toEqual({
      standard: "Du bist neugier",
      beast: null,
      kartenStandard: [],
      kartenBeast: [],
    });
  });

  test("Whitespace/Zeilenumbruch zwischen Schluessel, Doppelpunkt und Wert", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText" :\n  "Du bist').standard).toBe("Du bist");
  });

  test("abgeschlossener Standard-Wert (unescaptes Anfuehrungszeichen) — Text endet dort", () => {
    const praefix = '{"standard": {"profileText": "Du bist neugierig.", "categories": {"inter';
    expect(_extrahiereLiveText(praefix)).toEqual({
      standard: "Du bist neugierig.",
      beast: null,
      kartenStandard: [],
      kartenBeast: [],
    });
  });

  test("beast bleibt null, solange sein Wert nicht begonnen hat (Schluessel schon da)", () => {
    const praefix = '{"standard": {"profileText": "Standard-Text."}, "beast": {"profileText":';
    expect(_extrahiereLiveText(praefix)).toEqual({
      standard: "Standard-Text.",
      beast: null,
      kartenStandard: [],
      kartenBeast: [],
    });
  });

  test("beide begonnen: Praefix endet mitten im 2. Feld — beast traegt den bisherigen Text", () => {
    const praefix = '{"standard": {"profileText": "Standard-Text."}, "beast": {"profileText": "Du bist ein zynis';
    expect(_extrahiereLiveText(praefix)).toEqual({
      standard: "Standard-Text.",
      beast: "Du bist ein zynis",
      kartenStandard: [],
      kartenBeast: [],
    });
  });

  test("beide abgeschlossen: 1. Vorkommen = standard, 2. Vorkommen = beast", () => {
    const praefix = '{"standard": {"profileText": "Standard-Text."}, "beast": {"profileText": "Beast-Text."}}';
    expect(_extrahiereLiveText(praefix)).toEqual({
      standard: "Standard-Text.",
      beast: "Beast-Text.",
      kartenStandard: [],
      kartenBeast: [],
    });
  });

  test("Umlaute und Emojis als rohe Zeichen bleiben erhalten", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText": "Grüße aus Österreich 🎉 und weiter').standard).toBe(
      "Grüße aus Österreich 🎉 und weiter"
    );
  });
});

describe("extrahiereLiveText — Escapes", () => {
  test("Escapes werden zu echten Zeichen dekodiert", () => {
    const praefix =
      '{"standard": {"profileText": "Er sagt \\"Hallo\\" und macht\\neinen Umbruch\\tmit Tab und \\\\ Backslash';
    expect(_extrahiereLiveText(praefix).standard).toBe(
      'Er sagt "Hallo" und macht\neinen Umbruch\tmit Tab und \\ Backslash'
    );
  });

  test("\\uXXXX-Escapes werden aufgeloest — auch Emoji-Surrogatpaare", () => {
    const praefix = '{"standard": {"profileText": "Umlaut \\u00e4, Gedankenstrich \\u2014, Emoji \\ud83d\\ude00!"';
    expect(_extrahiereLiveText(praefix).standard).toBe("Umlaut ä, Gedankenstrich —, Emoji 😀!");
  });

  test('Praefix endet mitten in \\" — der nackte Backslash wird abgeschnitten', () => {
    expect(_extrahiereLiveText('{"standard": {"profileText": "Zitat: \\').standard).toBe("Zitat: ");
  });

  test("Praefix endet mitten in \\u00 — das halbe Escape wird abgeschnitten", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText": "Etwa 25\\u00').standard).toBe("Etwa 25");
    expect(_extrahiereLiveText('{"standard": {"profileText": "Etwa 25\\u').standard).toBe("Etwa 25");
    expect(_extrahiereLiveText('{"standard": {"profileText": "Etwa 25\\u00b').standard).toBe("Etwa 25");
  });

  test("ein komplettes \\uXXXX am Praefix-Ende bleibt erhalten", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText": "25\\u00b0').standard).toBe("25°");
  });

  test("einsame hohe Surrogathälfte am Ende (halbes Emoji) wird abgeschnitten", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText": "Feier \\ud83d').standard).toBe("Feier ");
  });

  test("ein escaptes Anfuehrungszeichen beendet den Wert NICHT", () => {
    expect(_extrahiereLiveText('{"standard": {"profileText": "Er sagt \\"Servus\\" und geht').standard).toBe(
      'Er sagt "Servus" und geht'
    );
  });

  test("die geprüfte Escape-Behandlung gilt unveraendert auch fuer das 2. Feld (beast)", () => {
    const praefix = '{"standard": {"profileText": "Fertig."}, "beast": {"profileText": "Er sagt \\"Zack\\u2014';
    expect(_extrahiereLiveText(praefix).beast).toBe('Er sagt "Zack—');
    /* Und auch das Abschneiden halber Escapes am Praefix-Ende: */
    expect(
      _extrahiereLiveText('{"standard": {"profileText": "Fertig."}, "beast": {"profileText": "Etwa 25\\u00').beast
    ).toBe("Etwa 25");
  });
});

/* ── KA-11 (Kurzaudit 2026-08-12): Verankerung am Modus-Schluessel ──
   Die Reihenfolge „standard vor beast" haengt allein am Beispiel-Schema des
   Prompts — keine Garantie. Jeder Wert zaehlt deshalb nur noch, wenn er
   nachweislich zu SEINEM Modus-Block gehoert: Der harte Beast-Text darf nie
   als Standard-Profil erscheinen, egal was das Modell anstellt. */
describe("extrahiereLiveText — KA-11: Verankerung am Modus-Schluessel", () => {
  test("ein profileText VOR jedem Modus-Schluessel zaehlt fuer niemanden", () => {
    expect(_extrahiereLiveText('{"profileText": "Herrenlos und komplett."')).toEqual(NICHTS);
  });

  test("HAZARD-Fall: standard-Block OHNE profileText, beast MIT — der Beast-Text erscheint NICHT als Standard", () => {
    const praefix = '{"standard": {"ad_targeting": ["x"]}, "beast": {"profileText": "Du bist ein zynisches Ziel';
    expect(_extrahiereLiveText(praefix)).toEqual({
      standard: null,
      beast: "Du bist ein zynisches Ziel",
      kartenStandard: [],
      kartenBeast: [],
    });
  });

  test("komplett vertauschte Reihenfolge (beast zuerst): beide Texte landen trotzdem im RICHTIGEN Feld", () => {
    const praefix = '{"beast": {"profileText": "Boese Version."}, "standard": {"profileText": "Sachliche Vers';
    expect(_extrahiereLiveText(praefix)).toEqual({
      standard: "Sachliche Vers",
      beast: "Boese Version.",
      kartenStandard: [],
      kartenBeast: [],
    });
  });

  test("beast-Block offen ohne eigenen profileText, standard danach: nichts rutscht ins Beast-Feld", () => {
    const praefix = '{"beast": {"ad_targeting": ["x"]}, "standard": {"profileText": "Echt."';
    expect(_extrahiereLiveText(praefix)).toEqual({
      standard: "Echt.",
      beast: null,
      kartenStandard: [],
      kartenBeast: [],
    });
  });

  test("RUECKBAUPROBE Normalfall: gemessene Reihenfolge liefert byte-identisch dasselbe wie vor KA-11", () => {
    const praefix = '{"standard": {"profileText": "Standard-Text."}, "beast": {"profileText": "Beast-Text."}}';
    expect(_extrahiereLiveText(praefix)).toEqual({
      standard: "Standard-Text.",
      beast: "Beast-Text.",
      kartenStandard: [],
      kartenBeast: [],
    });
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

  test("onLiveText wird mit wachsenden { standard, beast }-Staenden gerufen und endet bei beiden Klartexten", async () => {
    setFetchForTest(async () => sseAntwort(baueSseText(fieseDeltas())));
    const wellen = [];
    await _callMistralRaw({
      model: "x",
      messages: [],
      maxTokens: 100,
      temperature: 0,
      onLiveText: (texte) => wellen.push(texte),
    });

    expect(wellen.length).toBeGreaterThanOrEqual(2);
    /* Jede Welle setzt die vorige fort — nie ein Ruecksprung, nie Muell.
       Beast ist null, bis sein Feld beginnt, und waechst danach genauso. */
    for (let i = 1; i < wellen.length; i++) {
      expect(wellen[i].standard.startsWith(wellen[i - 1].standard)).toBe(true);
      if (wellen[i - 1].beast !== null) {
        expect(wellen[i].beast.startsWith(wellen[i - 1].beast)).toBe(true);
      }
    }
    /* Die erste Welle ist echt unvollstaendig (und ohne Beast — das Modell
       schreibt sequenziell), die letzte traegt beide vollen Texte. */
    expect(wellen[0].standard.length).toBeLessThan(PROFIL_KLARTEXT.length);
    expect(wellen[0].beast).toBeNull();
    expect(wellen[wellen.length - 1].standard).toBe(PROFIL_KLARTEXT);
    expect(wellen[wellen.length - 1].beast).toBe("Beast.");
    /* Keine Welle enthaelt rohe JSON-Escapes — alles ist dekodiert. */
    for (const w of wellen) {
      expect(w.standard).not.toContain('\\"');
      expect(w.standard).not.toContain("\\u");
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

  test("opts.onLiveText schaltet den Stream ein und liefert Staende BEIDER profileText-Felder", async () => {
    const antwortJson = JSON.stringify(vollstaendigeAntwort());
    let body = null;
    setFetchForTest(async (_url, init) => {
      body = JSON.parse(init.body);
      return sseAntwort(baueSseText(zerteile(antwortJson, 40)));
    });

    const wellen = [];
    const result = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 60000, "de", {
      onLiveText: (texte) => wellen.push(texte),
    });

    expect(body.stream).toBe(true);
    /* Das Endergebnis ist das gewohnte { normal, boost }-Shape ... */
    expect(result.normal).toBeTruthy();
    expect(result.boost).toBeTruthy();
    expect(result.normal.profileText).toBe("Du bist sachlich beschrieben.");
    /* ... und die Wellen sind Praefixe des jeweiligen Texts: standard =
       1. Vorkommen, beast = 2. Vorkommen (null vor dessen Beginn). */
    expect(wellen.length).toBeGreaterThanOrEqual(1);
    for (const w of wellen) {
      expect("Du bist sachlich beschrieben.".startsWith(w.standard)).toBe(true);
      if (w.beast !== null) {
        expect("Du bist zynisch beschrieben.".startsWith(w.beast)).toBe(true);
      }
    }
    /* Die letzte Welle traegt den kompletten Beast-Text. */
    expect(wellen[wellen.length - 1].beast).toBe("Du bist zynisch beschrieben.");
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
