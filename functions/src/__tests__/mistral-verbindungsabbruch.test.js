/**
 * mistral-verbindungsabbruch.test.js — Reisst die Verbindung zu Mistral ab,
 * bekommt das Kind nicht sofort eine Fehlermeldung, und im Protokoll steht,
 * WARUM sie abriss.
 *
 * HINTERGRUND (Workshop 01.10.2026, 11:01 und 11:03): Zwei von 30 Analysen
 * scheiterten mit `error: "terminated"` — Node.js meldet so einen Strom, der
 * mitten in der Antwort abreisst. Den eigentlichen Grund ("Gegenseite hat
 * geschlossen", "Zeitlimit", ...) liefert Node.js in einem zweiten Feld
 * (`cause`), das nie protokolliert wurde; wer abgebrochen hatte, war deshalb
 * nicht feststellbar. Und es gab keinen zweiten Versuch: Beide Geraete zeigten
 * nach 82 bzw. 114 Sekunden "blocked.apiError".
 *
 * DATENSCHUTZ (Vorgabe, nicht Funktion): Das technische Protokoll darf laut
 * Datenschutzerklaerung nur Schritt, Erfolg, Dauer, Textmenge und die
 * Zufallsnummer tragen — "keine IP-Adresse". Node.js haengt an den Grund die
 * Verbindungsdaten (Adressen und Ports beider Seiten). Davon darf NICHTS ins
 * Protokoll, auch nicht die Adresse des Servers. Geprueft unten an jeder
 * geschriebenen Zeile.
 *
 * Reine Mock-Pruefung — kein Netzwerk, keine Cloud.
 */

jest.mock("../betriebsprofil", () => require("../test-satz").betriebsprofilMock());

const { setFetchForTest, runSingleLargeCall, generateBeastAds } = require("../mistral");
const { ursacheVon } = require("../verbindungsfehler");

const ORIGINAL_API_KEY = process.env.MISTRAL_API_KEY;
let protokoll;
let spione;
beforeEach(() => {
  process.env.MISTRAL_API_KEY = "test-key-not-real";
  protokoll = [];
  spione = ["log", "warn", "error"].map((art) =>
    jest.spyOn(console, art).mockImplementation((...args) => protokoll.push({ art, text: args.join(" ") }))
  );
});
afterEach(() => {
  setFetchForTest(null);
  for (const s of spione) s.mockRestore();
  if (ORIGINAL_API_KEY === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = ORIGINAL_API_KEY;
});

/* Die Pflichtkarten aus dem Programm selbst — eine abgeschriebene Liste liefe
   still auseinander, und eine fehlende Karte loest eine Nachfrage aus, die
   hier wie ein dritter Versuch aussaehe. */
const { REQUIRED_CARDS: KARTEN } = require("../mistral-antwort");
function alleKarten(prefix) {
  const out = {};
  for (const k of KARTEN) out[k] = { label: k, value: `${prefix} ${k}`, confidence: 0.8 };
  return out;
}
const VOLLSTAENDIG = JSON.stringify({
  subject: "PERSON",
  visible_text: "",
  hard_facts: {},
  ad_targeting: ["A"],
  manipulation_triggers: ["T"],
  standard: { profileText: "Du bist sachlich beschrieben.", categories: alleKarten("Standard") },
  beast: { profileText: "Du bist zynisch beschrieben.", categories: alleKarten("Beast") },
});

/* Der Grund, wie ihn Node.js (undici) bei einem abgerissenen Strom liefert —
   samt Verbindungsdaten, die NIE ins Protokoll duerfen. */
function abrissGrund() {
  const grund = new Error("other side closed");
  grund.name = "SocketError";
  grund.code = "UND_ERR_SOCKET";
  grund.socket = {
    localAddress: "169.254.8.1",
    localPort: 51234,
    remoteAddress: "104.18.33.7",
    remotePort: 443,
    remoteFamily: "IPv4",
    bytesWritten: 900000,
    bytesRead: 4321,
  };
  return grund;
}

/* Strom, der erst Text liefert und dann abreisst wie am 01.10. */
function stromDerAbreisst(text) {
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  let gesendet = false;
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      pull(controller) {
        if (!gesendet) {
          gesendet = true;
          controller.enqueue(bytes);
          return;
        }
        controller.error(new TypeError("terminated", { cause: abrissGrund() }));
      },
    }),
  };
}

/* Antwort in einem Stueck — so antwortet Mistral, wenn ohne Strom gefragt
   wird (der Neuversuch fragt ohne Live-Text, also ohne Strom). */
function stueckAntwort(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage: {} }),
  };
}
function stueckDasAbreisst() {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new TypeError("terminated", { cause: abrissGrund() });
    },
  };
}
/* Wie Mistral: Strom nur, wenn danach gefragt wurde. */
const gestreamt = (init) => JSON.parse(init.body).stream === true;
/* Gezaehlt wird nur der Analyse-Aufruf MIT Bild — zu jeder Analyse gehoert
   ausserdem ein kleiner zweiter Aufruf ohne Bild (Werbeliste), der hier
   nicht interessiert und eine fertige Antwort bekommt. */
const mitBild = (init) => String(init && init.body).includes("image_url");
const WERBUNG = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "{}" } }], usage: {} }) };

/* Auch Bruchstuecke: zwei Zahlengruppen mit Punkt, "::" oder Hex-Gruppen mit
   Doppelpunkt — eine halb maskierte Adresse ist auch eine Adresse. */
const IP = /\d{1,3}\.\d{1,3}|::|[0-9a-f]{1,4}:[0-9a-f]{1,4}:/i;
function keineAdressenImProtokoll() {
  for (const z of protokoll) {
    expect(z.text).not.toMatch(IP);
    expect(z.text).not.toMatch(/remoteAddress|localAddress|remotePort|localPort|bytesWritten/);
  }
}
const zeilen = (art) => protokoll.filter((z) => z.art === art).map((z) => z.text);

describe("Verbindungsabriss beim Single-Large-Aufruf", () => {
  test("ein Abriss mitten im Strom wird einmal neu versucht — das Kind bekommt sein Ergebnis", async () => {
    let aufrufe = 0;
    const strom = [];
    setFetchForTest(async (_url, init) => {
      if (!mitBild(init)) return WERBUNG;
      aufrufe += 1;
      strom.push(gestreamt(init));
      return aufrufe === 1
        ? stromDerAbreisst('{"subject":"PERSON","standard":{"profileText":"Du bi')
        : stueckAntwort(VOLLSTAENDIG);
    });

    const ergebnis = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 240000, "de", {
      onLiveText: () => {},
    });

    expect(aufrufe).toBe(2);
    /* Erster Versuch mit Live-Text (Strom), der Neuversuch ohne. */
    expect(strom).toEqual([true, false]);
    expect(ergebnis.normal.profileText).toBe("Du bist sachlich beschrieben.");
    /* Kein Alarm: Der erste Versuch ist eine Warnung, kein Fehler. */
    expect(zeilen("error").join("\n")).not.toMatch(/single-large-failed/);
    const warnung = zeilen("warn").find((t) => t.includes("abbruch-neuversuch"));
    expect(warnung).toBeDefined();
    const w = JSON.parse(warnung);
    expect(w.severity).toBe("WARNING");
    expect(w.ursache).toEqual({ code: "UND_ERR_SOCKET", text: "other side closed" });
    keineAdressenImProtokoll();
  });

  test("reisst auch der zweite Versuch ab: Fehler mit Grund, ohne Adressen — und kein dritter Versuch", async () => {
    let aufrufe = 0;
    setFetchForTest(async (_url, init) => {
      if (!mitBild(init)) return WERBUNG;
      aufrufe += 1;
      return gestreamt(init) ? stromDerAbreisst('{"subj') : stueckDasAbreisst();
    });

    await expect(
      runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 240000, "de", { onLiveText: () => {} })
    ).rejects.toThrow(/terminated/);

    expect(aufrufe).toBe(2);
    const fehler = zeilen("error").filter((t) => t.includes("single-large-failed"));
    expect(fehler).toHaveLength(1);
    const f = JSON.parse(fehler[0]);
    expect(f.attempt).toBe("neuversuch");
    expect(f.ursache).toEqual({ code: "UND_ERR_SOCKET", text: "other side closed" });
    keineAdressenImProtokoll();
  });

  test("steht im abgerissenen Strom schon ein brauchbares Ergebnis, wird es gerettet statt neu gefragt", async () => {
    let aufrufe = 0;
    const fastFertig = JSON.stringify({
      subject: "HUMAN",
      standard: {
        profileText: "Du bist ein Mann Anfang dreissig.",
        categories: { alter_geschlecht: { value: "30-35" } },
      },
      beast: {
        profileText: "Wir wissen, dass du gerne wanderst.",
        categories: { alter_geschlecht: { value: "30-35" } },
      },
    }).slice(0, -3);
    setFetchForTest(async (_url, init) => {
      if (!mitBild(init)) return WERBUNG;
      aufrufe += 1;
      return aufrufe === 1 ? stromDerAbreisst(fastFertig) : stueckAntwort(VOLLSTAENDIG);
    });

    const ergebnis = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 240000, "de", {
      onLiveText: () => {},
    });

    expect(ergebnis.normal.profileText).toContain("Anfang dreissig");
    /* Die Rettung kommt vor dem Neuversuch; ein zweiter Aufruf kann nur die
       Nachfrage nach fehlenden Karten sein, nie ein Neuversuch. */
    expect(zeilen("warn").join("\n")).not.toMatch(/abbruch-neuversuch/);
    keineAdressenImProtokoll();
  });

  test("Abbruch schon vor der Antwort (fetch failed) wird ebenso einmal neu versucht", async () => {
    let aufrufe = 0;
    setFetchForTest(async (_url, init) => {
      if (!mitBild(init)) return WERBUNG;
      aufrufe += 1;
      if (aufrufe === 1) {
        const grund = new Error("read ECONNRESET 104.18.33.7:443");
        grund.code = "ECONNRESET";
        throw new TypeError("fetch failed", { cause: grund });
      }
      return stueckAntwort(VOLLSTAENDIG);
    });

    const ergebnis = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 240000, "de", {
      onLiveText: () => {},
    });

    expect(aufrufe).toBe(2);
    expect(ergebnis.normal).toBeTruthy();
    const w = JSON.parse(zeilen("warn").find((t) => t.includes("abbruch-neuversuch")));
    /* Der Text enthielt eine Adresse und steht nicht in der Positivliste:
       Er wird verworfen, nur der Code bleibt. */
    expect(w.ursache).toEqual({ code: "ECONNRESET", text: null });
    keineAdressenImProtokoll();
  });

  test("ein HTTP-Fehler von Mistral (400) ist KEIN Verbindungsabriss — kein Neuversuch", async () => {
    let aufrufe = 0;
    setFetchForTest(async (_url, init) => {
      if (!mitBild(init)) return WERBUNG;
      aufrufe += 1;
      return { ok: false, status: 400, text: async () => '{"message":"bad request"}' };
    });

    await expect(
      runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 240000, "de", { onLiveText: () => {} })
    ).rejects.toThrow(/HTTP 400/);
    expect(aufrufe).toBe(1);
  });

  test("Abriss beim Lesen einer Antwort OHNE Strom wird ebenso einmal neu versucht", async () => {
    let aufrufe = 0;
    setFetchForTest(async (_url, init) => {
      if (!mitBild(init)) return WERBUNG;
      aufrufe += 1;
      return aufrufe === 1 ? stueckDasAbreisst() : stueckAntwort(VOLLSTAENDIG);
    });
    /* Ohne onLiveText: kein Strom, die Antwort kommt in einem Stueck. */
    const ergebnis = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 240000, "de");
    expect(aufrufe).toBe(2);
    expect(ergebnis.normal.profileText).toBe("Du bist sachlich beschrieben.");
    keineAdressenImProtokoll();
  });

  test("scheitert nur die Nachfrage nach fehlenden Karten: Warnung, kein Alarm — die Analyse ist geliefert", async () => {
    let aufrufe = 0;
    const ohneKarten = JSON.parse(VOLLSTAENDIG);
    delete ohneKarten.beast.categories.werbeprofil;
    setFetchForTest(async (_url, init) => {
      if (!mitBild(init)) return WERBUNG;
      aufrufe += 1;
      return aufrufe === 1 ? stueckAntwort(JSON.stringify(ohneKarten)) : stueckDasAbreisst();
    });
    const ergebnis = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 240000, "de");
    expect(aufrufe).toBe(2);
    expect(ergebnis.normal.profileText).toBe("Du bist sachlich beschrieben.");
    expect(zeilen("error").join("\n")).not.toMatch(/single-large-failed/);
    const w = JSON.parse(zeilen("warn").find((t) => t.includes("nachfrage-gescheitert")));
    expect(w.severity).toBe("WARNING");
    expect(w.alert).toBeUndefined();
    expect(w.ursache).toEqual({ code: "UND_ERR_SOCKET", text: "other side closed" });
    keineAdressenImProtokoll();
  });

  /* Befund Q-02: Traegt die erste Antwort KEIN Profil und scheitert die
     Nachfrage, ist die Analyse NICHT geliefert — das muss alarmieren. */
  test("erste Antwort ohne Profil, Nachfrage scheitert: Fehlerzeile mit Alarm", async () => {
    let aufrufe = 0;
    setFetchForTest(async (_url, init) => {
      if (!mitBild(init)) return WERBUNG;
      aufrufe += 1;
      return aufrufe === 1 ? stueckAntwort(JSON.stringify({ subject: "PERSON" })) : stueckDasAbreisst();
    });
    const ergebnis = await runSingleLargeCall(Buffer.from("bild"), "image/jpeg", () => 240000, "de");
    expect(aufrufe).toBe(2);
    expect(ergebnis.normal).toBeFalsy();
    const fehler = zeilen("error").filter((t) => t.includes("single-large-failed"));
    expect(fehler).toHaveLength(1);
    expect(JSON.parse(fehler[0]).attempt).toBe("retry-ohne-ergebnis");
    expect(zeilen("warn").join("\n")).not.toMatch(/nachfrage-gescheitert/);
    keineAdressenImProtokoll();
  });

  test("auch die Fehlerzeile des Werbe-Aufrufs nennt den Grund — ohne Adressen", async () => {
    setFetchForTest(async () => {
      const grund = new Error("connect ECONNREFUSED ::ffff:104.18.33.7:443");
      grund.code = "ECONNREFUSED";
      throw new TypeError("fetch failed", { cause: grund });
    });
    const liste = await generateBeastAds({ profileText: "x", categories: {} }, ["A"], "de");
    expect(liste).toBeNull();
    const f = JSON.parse(zeilen("error").find((t) => t.includes("beast-ads-failed")));
    expect(f.ursache).toEqual({ code: "ECONNREFUSED", text: null });
    keineAdressenImProtokoll();
  });
});

/* Befund R-03: Die Positivliste laesst nur feste, bekannte Texte durch —
   jede Adress-Schreibweise, auch die, an denen eine Maskierung scheiterte. */
describe("ursacheVon: nur Code und bekannte feste Texte", () => {
  const grund = (meldung, code) => {
    const g = new Error(meldung);
    if (code) g.code = code;
    return ursacheVon(new TypeError("fetch failed", { cause: g }));
  };
  test.each([
    ["connect ECONNREFUSED ::ffff:192.168.1.1", "ECONNREFUSED"],
    ["connect ECONNREFUSED [::ffff:10.20.30.40]:443", "ECONNREFUSED"],
    ["attempted address: ::ffff:104.18.33.7", "ECONNREFUSED"],
    ["getaddrinfo ENOTFOUND api.mistral.ai", "ENOTFOUND"],
    ["connect ECONNREFUSED ::1:45871", "ECONNREFUSED"],
    ["connect ECONNREFUSED 127.0.0.1:443", "ECONNREFUSED"],
  ])("%s -> nur der Code", (meldung, code) => {
    expect(grund(meldung, code)).toEqual({ code, text: null });
  });
  test("bekannte feste Texte bleiben", () => {
    expect(grund("other side closed", "UND_ERR_SOCKET")).toEqual({ code: "UND_ERR_SOCKET", text: "other side closed" });
    expect(grund("read ECONNRESET", "ECONNRESET")).toEqual({ code: "ECONNRESET", text: "read ECONNRESET" });
  });
  test("ein Code, der keine feste Kennung ist, faellt weg", () => {
    expect(grund("x", "nicht 1.2.3.4")).toBeNull();
  });
});
