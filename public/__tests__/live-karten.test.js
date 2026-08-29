/**
 * live-karten.test.js — Die Merkmale, die sich während der Analyse aufbauen.
 *
 * HINTERGRUND (FEATURE-2026-08-29-01): Alle dreizehn Karten stehen von Beginn
 * an da, zunächst unscharf, und stellen sich einzeln scharf, sobald die KI das
 * Merkmal geschrieben hat.
 *
 * Geprüft wird vor allem das, was die Testsuiten am 29.08. NICHT gefunden
 * haben und erst der Blick in den Browser zeigte — sowie die Barrierefreiheit
 * der leeren Karten, die im E2E-Lauf gar nicht vorkommen (dort wird nur der
 * Endzustand gemessen).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../js/error-logger.js", () => ({ logClientError: vi.fn() }));
vi.mock("../js/i18n.js", () => ({
  t: (schluessel) => schluessel,
  getLanguage: () => "de",
}));
vi.mock("../js/state.js", () => ({ state: { lastPrepared: null, geocodeCache: null } }));

const KARTEN = [
  { schluessel: "alter_geschlecht", bezeichnung: "Alter & Geschlecht", wert: "Männlich, etwa 32" },
  { schluessel: "herkunft", bezeichnung: "Herkunft", wert: "Mitteleuropa" },
];

describe("Merkmale während der Analyse", () => {
  let zeigeLiveKarten, liveKartenZuruecksetzen, liveKartenModusWechsel, elements;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="facts"></div><div id="privacy"></div><div id="gpsMap"></div>';
    vi.resetModules();
    const dom = await import("../js/dom.js");
    elements = dom.elements;
    const render = await import("../js/render.js");
    ({ zeigeLiveKarten, liveKartenZuruecksetzen, liveKartenModusWechsel } = render);
    liveKartenZuruecksetzen();
  });

  it("baut das vollständige Gerüst, nicht nur die fertigen Karten", () => {
    /* Erschienen die Karten einzeln aus dem Nichts, wirkte jede Pause wie das
       Ende — man sah nie, wie viel noch kommt. */
    zeigeLiveKarten(KARTEN);

    const alle = elements.facts.querySelectorAll(".cat-card");
    expect(alle.length).toBeGreaterThan(KARTEN.length);
    expect(alle.length).toBe(13);
  });

  it("leere Karten sind unscharf, gelieferte nicht", () => {
    zeigeLiveKarten(KARTEN);

    const fertig = elements.facts.querySelector('.cat-card[data-key="alter_geschlecht"]');
    const leer = elements.facts.querySelector('.cat-card[data-key="politisch"]');
    expect(fertig.classList.contains("cat-card--unscharf")).toBe(false);
    expect(leer.classList.contains("cat-card--unscharf")).toBe(true);
  });

  it("leere Karten sind für Screenreader nicht vorhanden", () => {
    /* Dreizehnmal „Wird ausgewertet" wäre Lärm, und die Konfidenz-Punkte
       kündigen eine Sicherheit an, die es noch nicht gibt. Sie werden hörbar,
       sobald sie Inhalt haben. */
    zeigeLiveKarten(KARTEN);

    const fertig = elements.facts.querySelector('.cat-card[data-key="alter_geschlecht"]');
    const leer = elements.facts.querySelector('.cat-card[data-key="politisch"]');
    expect(leer.getAttribute("aria-hidden")).toBe("true");
    expect(fertig.hasAttribute("aria-hidden")).toBe(false);
  });

  it("baut das Feld bei weiteren Karten NICHT neu auf", () => {
    /* Der Neuaufbau bei jeder Welle liess das ganze Ergebnis aufblitzen und sah
       aus wie ein Neuladen der Seite. */
    zeigeLiveKarten(KARTEN);
    const vorher = elements.facts.querySelector('.cat-card[data-key="alter_geschlecht"]');

    zeigeLiveKarten([...KARTEN, { schluessel: "bildung", bezeichnung: "Bildung", wert: "Studium" }]);
    const nachher = elements.facts.querySelector('.cat-card[data-key="alter_geschlecht"]');

    expect(nachher).toBe(vorher); /* dasselbe Element, nicht ein neues */
  });

  it("der Moduswechsel setzt die Inhalte zurück, nicht das Gerüst", () => {
    /* Ohne das Zurücksetzen stand nach dem Umschalten auf Beast weiter der
       seriöse Text, bis das Endergebnis kam. */
    zeigeLiveKarten(KARTEN);
    const vorher = elements.facts.querySelector('.cat-card[data-key="alter_geschlecht"]');
    expect(vorher.querySelector(".cat-value").textContent).toContain("Männlich");

    liveKartenModusWechsel();

    const nachher = elements.facts.querySelector('.cat-card[data-key="alter_geschlecht"]');
    expect(nachher).toBe(vorher); /* Gerüst steht */
    expect(nachher.classList.contains("cat-card--unscharf")).toBe(true);
    expect(nachher.getAttribute("aria-hidden")).toBe("true");
    expect(nachher.querySelector(".cat-value").textContent).not.toContain("Männlich");
  });
});
