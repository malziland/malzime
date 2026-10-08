import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

/* Die Merkmal-Karten werden gestaffelt scharfgestellt (render.js,
   zeigeLiveKarten: je Karte ein Zeitgeber im 400-ms-Takt, bei 13 Karten also
   4,8 Sekunden). Nach einem Wechsel der Profil-Art oder nach dem fertigen
   Ergebnis darf kein solcher Zeitgeber mehr feuern — sonst steht in den Karten
   der Inhalt des ANDEREN Profils (BUG-2026-10-03-45). */

const SCHLUESSEL = [
  "alter_geschlecht",
  "herkunft",
  "beziehungsstatus",
  "bildung",
  "persoenlichkeit",
  "charakterzuege",
  "interessen",
  "einkommen",
  "kaufkraft",
  "werbeprofil",
  "verletzlichkeit",
  "gesundheit",
  "politisch",
];

function karten(art) {
  return SCHLUESSEL.map((k) => ({ schluessel: k, bezeichnung: `${art}-LABEL-${k}`, wert: `${art}-WERT-${k}` }));
}

function profil(art) {
  const categories = {};
  for (const k of SCHLUESSEL)
    categories[k] = { label: `${art}-LABEL-${k}`, value: `${art}-WERT-${k}`, confidence: 0.8 };
  return { profileText: `${art}-TEXT`, categories, ad_targeting: [`${art}-AD`], manipulation_triggers: [`${art}-TR`] };
}

const ERGEBNIS = {
  profiles: { normal: profil("SERIOES"), boost: profil("BEAST") },
  privacyRisks: [],
  exif: {},
  meta: { mode: "multimodal", subject: "HUMAN" },
};

describe("Merkmal-Karten: Zeitgeber der gestaffelten Einblendung", () => {
  let render, elements, state;

  beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    vi.useFakeTimers();
    render = await import("../js/render.js");
    elements = (await import("../js/dom.js")).elements;
    state = (await import("../js/state.js")).state;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Positivkontrolle: ohne Wechsel stehen nach 5 s alle 13 Karten scharf mit seriösem Inhalt", () => {
    render.zeigeLiveKarten(karten("SERIOES"));
    vi.advanceTimersByTime(5000);
    const scharf = [...elements.facts.querySelectorAll(".cat-card:not(.cat-card--unscharf)")];
    expect(scharf.length).toBe(13);
    expect(scharf.every((k) => k.textContent.includes("SERIOES"))).toBe(true);
  });

  it("a) Wechsel auf Beast mitten in der Einblendung: keine seriöse Karte wird danach noch scharfgestellt", () => {
    render.zeigeLiveKarten(karten("SERIOES")); /* Zeitgeber fuer Karte 2..13: 400 ms .. 4800 ms */
    vi.advanceTimersByTime(500);
    elements.biasSwitch.checked = true; /* Nutzer schaltet um */
    render.liveKartenModusWechsel(); /* das ruft live-anzeige.js modusWechsel() */
    const direktDanach = [...elements.facts.querySelectorAll(".cat-card:not(.cat-card--unscharf)")].length;
    vi.advanceTimersByTime(6000); /* Beast-Karten gibt es noch keine */
    const scharf = [...elements.facts.querySelectorAll(".cat-card:not(.cat-card--unscharf)")];
    const serioes = scharf.filter((k) => k.textContent.includes("SERIOES"));
    expect(direktDanach).toBe(0);
    expect(serioes.length).toBe(0);
  });

  it("b) Fertiges Ergebnis in der Beast-Art, waehrend die Einblendung der seriösen Karten noch laeuft: Endwerte bleiben stehen", () => {
    render.zeigeLiveKarten(karten("SERIOES"));
    vi.advanceTimersByTime(500);
    elements.biasSwitch.checked = true;
    render.renderCurrentMode(ERGEBNIS); /* rendert das Beast-Profil endgueltig */
    const vorher = [...elements.facts.querySelectorAll(".cat-value")].filter((e) =>
      e.textContent.includes("SERIOES")
    ).length;
    vi.advanceTimersByTime(6000);
    const werte = [...elements.facts.querySelectorAll(".cat-value")].map((e) => e.textContent);
    const serioes = werte.filter((w) => w.includes("SERIOES"));
    expect(vorher).toBe(0);
    expect(serioes.length).toBe(0);
  });

  it("c) Ganzer Ablauf ueber live-anzeige.js (welle, modusWechsel) bei reduzierter Bewegung", async () => {
    window.matchMedia = () => ({ matches: true }); /* reduzierte Bewegung: kein 25-s-Anlauf */
    const live = await import("../js/live-anzeige.js");
    state.lastPrepared = { exif: { make: "X", model: "Y" }, gps: null, dateTimeOriginal: null };
    const w = { standard: "Profiltext.", beast: null, kartenStandard: karten("SERIOES"), kartenBeast: null };
    live.welle(w);
    vi.advanceTimersByTime(2000);
    live.welle(w); /* Text steht: versteckte Daten erscheinen */
    vi.advanceTimersByTime(2000);
    live.welle(w); /* jetzt die Karten — Einblendung startet */
    vi.advanceTimersByTime(500);
    const scharfVorWechsel = elements.facts.querySelectorAll(".cat-card:not(.cat-card--unscharf)").length;
    elements.biasSwitch.checked = true;
    live.modusWechsel();
    vi.advanceTimersByTime(6000);
    const scharf = [...elements.facts.querySelectorAll(".cat-card:not(.cat-card--unscharf)")];
    const serioes = scharf.filter((k) => k.textContent.includes("SERIOES"));
    expect(scharfVorWechsel).toBeGreaterThan(0);
    expect(serioes.length).toBe(0);
    live.zuruecksetzen();
  });
});
