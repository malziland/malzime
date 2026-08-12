const { pruefeZusagen, baueMeldung } = require("../handle-erinnerung");
const { leseZdrPruefdatum, bewerteFrist, formatiereDatum, FRIST_TAGE, VORWARNUNG_TAGE } = require("../zusagen");

/**
 * Tests für die woechentliche Zusagen-Erinnerung.
 *
 * Kein Netz, keine echte Uhr: `abruf` und `jetzt` werden injiziert. Geprueft
 * wird vor allem das, was im Ernstfall zaehlt — dass der Push GENAU DANN
 * kommt, wenn er soll, und dass ein Fehler den Betrieb nie stoert.
 */

const SEITE = (datum) => `<p>… Zero Data Retention … zuletzt am ${datum} überprüft und dokumentiert; …</p>`;

/* 2026-08-12 als feste „Jetzt"-Zeit — Tests duerfen nicht von der Uhr abhaengen. */
const JETZT = new Date(2026, 7, 12).getTime();
const TAG = 86400000;

function abrufAttrappe({ html, seiteOk = true, ntfyOk = true, protokoll }) {
  return async (url, optionen) => {
    if (String(url).includes("datenschutz")) {
      if (!seiteOk) return { ok: false, status: 503, text: async () => "" };
      return { ok: true, status: 200, text: async () => html };
    }
    /* ntfy-Aufruf */
    if (protokoll) protokoll.push(JSON.parse(optionen.body));
    return { ok: ntfyOk, status: ntfyOk ? 200 : 500, text: async () => "" };
  };
}

describe("zusagen.js — Fristlogik", () => {
  test("liest das Prüfdatum aus der Seite (mit geschütztem Leerzeichen)", () => {
    const datum = leseZdrPruefdatum(SEITE("11.&nbsp;August&nbsp;2026"));
    expect(formatiereDatum(datum)).toBe("11. August 2026");
  });

  test("liest das Prüfdatum auch mit normalen Leerzeichen", () => {
    expect(leseZdrPruefdatum(SEITE("1. März 2026"))).not.toBeNull();
  });

  test("gibt null zurück, wenn die Formulierung geändert wurde", () => {
    expect(leseZdrPruefdatum("<p>zuletzt kontrolliert am 11. August 2026</p>")).toBeNull();
  });

  test("gibt null zurück bei unbekanntem Monatsnamen", () => {
    expect(leseZdrPruefdatum(SEITE("11. Auguscht 2026"))).toBeNull();
  });

  test("frisches Datum ist nicht fällig", () => {
    const stand = bewerteFrist(new Date(JETZT - 10 * TAG), JETZT);
    expect(stand.faellig).toBe(false);
    expect(stand.ueberfaellig).toBe(false);
  });

  test("genau in der Vorwarnzeit ist fällig, aber nicht überfällig", () => {
    const stand = bewerteFrist(new Date(JETZT - (FRIST_TAGE - VORWARNUNG_TAGE) * TAG), JETZT);
    expect(stand.faellig).toBe(true);
    expect(stand.ueberfaellig).toBe(false);
  });

  test("nach Ablauf der Frist ist überfällig", () => {
    const stand = bewerteFrist(new Date(JETZT - (FRIST_TAGE + 5) * TAG), JETZT);
    expect(stand.ueberfaellig).toBe(true);
    expect(stand.tageBisFrist).toBe(-5);
  });
});

describe("pruefeZusagen — Push nur wenn nötig", () => {
  test("schickt NICHTS, solange die Frist weit weg ist", async () => {
    const protokoll = [];
    const html = SEITE(formatiereDatum(new Date(JETZT - 10 * TAG)));
    const ergebnis = await pruefeZusagen({
      ntfyUrl: "https://ntfy.example/x",
      ntfyTopic: "t",
      abruf: abrufAttrappe({ html, protokoll }),
      jetzt: JETZT,
    });
    expect(ergebnis.gesendet).toBe(false);
    expect(ergebnis.grund).toBe("nichts-faellig");
    expect(protokoll).toEqual([]);
  });

  test("schickt eine Woche vorher den Push mit Anleitung", async () => {
    const protokoll = [];
    const html = SEITE(formatiereDatum(new Date(JETZT - (FRIST_TAGE - VORWARNUNG_TAGE) * TAG)));
    const ergebnis = await pruefeZusagen({
      ntfyUrl: "https://ntfy.example/x",
      ntfyTopic: "t",
      abruf: abrufAttrappe({ html, protokoll }),
      jetzt: JETZT,
    });
    expect(ergebnis.gesendet).toBe(true);
    expect(protokoll).toHaveLength(1);
    const push = protokoll[0];
    expect(push.title).toMatch(/steht an/);
    /* Die Anleitung ist der Kern — ohne sie waere die Erinnerung wertlos. */
    expect(push.message).toMatch(/Mistral-Dashboard|Null-Datenspeicherung/);
    expect(push.message).toMatch(/Screenshot/);
    expect(push.message).toMatch(/NIE ohne echte Prüfung/);
    expect(push.actions[0].url).toMatch(/admin\.mistral\.ai/);
  });

  test("meldet Überfälligkeit deutlicher (höhere Priorität, anderer Titel)", async () => {
    const protokoll = [];
    const html = SEITE(formatiereDatum(new Date(JETZT - (FRIST_TAGE + 20) * TAG)));
    await pruefeZusagen({
      ntfyUrl: "https://ntfy.example/x",
      ntfyTopic: "t",
      abruf: abrufAttrappe({ html, protokoll }),
      jetzt: JETZT,
    });
    expect(protokoll[0].title).toMatch(/überfällig/i);
    expect(protokoll[0].priority).toBe(5);
    expect(protokoll[0].message).toMatch(/ÜBERFÄLLIG seit 20 Tagen/);
  });
});

describe("pruefeZusagen — fail-soft", () => {
  test("Seite nicht erreichbar: kein Absturz, kein Push", async () => {
    const ergebnis = await pruefeZusagen({
      ntfyUrl: "https://ntfy.example/x",
      ntfyTopic: "t",
      abruf: abrufAttrappe({ html: "", seiteOk: false }),
      jetzt: JETZT,
    });
    expect(ergebnis).toEqual({ gesendet: false, grund: "seite-nicht-lesbar" });
  });

  test("Prüfdatum unlesbar (Formulierung geändert): kein Absturz, kein Push", async () => {
    const ergebnis = await pruefeZusagen({
      ntfyUrl: "https://ntfy.example/x",
      ntfyTopic: "t",
      abruf: abrufAttrappe({ html: "<p>ohne Datum</p>" }),
      jetzt: JETZT,
    });
    expect(ergebnis).toEqual({ gesendet: false, grund: "pruefdatum-unlesbar" });
  });

  test("ntfy antwortet mit Fehler: kein Absturz", async () => {
    const html = SEITE(formatiereDatum(new Date(JETZT - (FRIST_TAGE + 1) * TAG)));
    const ergebnis = await pruefeZusagen({
      ntfyUrl: "https://ntfy.example/x",
      ntfyTopic: "t",
      abruf: abrufAttrappe({ html, ntfyOk: false }),
      jetzt: JETZT,
    });
    expect(ergebnis).toEqual({ gesendet: false, grund: "ntfy-fehlgeschlagen" });
  });

  test("Netzfehler beim Abruf: kein Absturz", async () => {
    const ergebnis = await pruefeZusagen({
      ntfyUrl: "https://ntfy.example/x",
      ntfyTopic: "t",
      abruf: async () => {
        throw new Error("Netz weg");
      },
      jetzt: JETZT,
    });
    expect(ergebnis).toEqual({ gesendet: false, grund: "fehler" });
  });

  test("fehlende ntfy-Konfiguration: kein Absturz", async () => {
    const html = SEITE(formatiereDatum(new Date(JETZT - (FRIST_TAGE + 1) * TAG)));
    const ergebnis = await pruefeZusagen({
      abruf: abrufAttrappe({ html }),
      jetzt: JETZT,
    });
    expect(ergebnis).toEqual({ gesendet: false, grund: "keine-ntfy-konfiguration" });
  });
});

describe("baueMeldung", () => {
  test("nennt die drei Schritte in der richtigen Reihenfolge", () => {
    const meldung = baueMeldung({ tageAlt: 180, tageBisFrist: 3, ueberfaellig: false, datumText: "11. August 2026" });
    const pos1 = meldung.text.indexOf("1.");
    const pos2 = meldung.text.indexOf("2.");
    const pos3 = meldung.text.indexOf("3.");
    expect(pos1).toBeGreaterThan(-1);
    expect(pos2).toBeGreaterThan(pos1);
    expect(pos3).toBeGreaterThan(pos2);
  });
});
