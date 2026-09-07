/**
 * client-context-automatisiert.test.js — die Fehlermeldung sagt, ob der
 * Browser sich selbst als automatisiert ausweist.
 *
 * ANLASS (Nachuntersuchung 07.09.2026): Zehn Meldungen "demo-image-load:
 * Failed to fetch" in 30 Tagen, alle von "Chrome 141/142 / Windows", alle in
 * null Millisekunden, jedes Mal alle drei Demo-Knoepfe nacheinander. Kein
 * echter Nutzer hatte in derselben Zeit diese Browserversion; zwei Clients
 * meldeten eine Netzlatenz von null. Mit hoher Sicherheit automatisierte
 * Browser, die Knoepfe klicken und Bild-Abrufe blockieren — aber erst nach
 * einer Stunde Messen, weil das Kennzeichen fehlte, das jeder solche Browser
 * selbst setzt: `navigator.webdriver`.
 *
 * Das Feld ist ein Ja/Nein-Wert ohne Personenbezug. Es filtert NICHTS —
 * unsere eigenen E2E-Tests laufen mit webdriver=true und pruefen die
 * Fehlererfassung; ein Filter haette sie blind gemacht.
 */
import { describe, test, expect, afterEach } from "vitest";
import { collectClientContext } from "../js/client-context.js";

const original = Object.getOwnPropertyDescriptor(globalThis.Navigator.prototype, "webdriver");

function setzeWebdriver(wert) {
  Object.defineProperty(navigator, "webdriver", { value: wert, configurable: true });
}

afterEach(() => {
  delete navigator.webdriver;
  if (original) Object.defineProperty(globalThis.Navigator.prototype, "webdriver", original);
});

describe("collectClientContext: Kennzeichen 'automatisiert' (07.09.2026)", () => {
  test("ein automatisierter Browser meldet automatisiert: true", () => {
    setzeWebdriver(true);
    expect(collectClientContext().automatisiert).toBe(true);
  });

  test("ein gewoehnlicher Browser meldet automatisiert: false", () => {
    setzeWebdriver(false);
    expect(collectClientContext().automatisiert).toBe(false);
  });

  test("kennt der Browser das Merkmal nicht, fehlt das Feld — kein erfundener Wert", () => {
    setzeWebdriver(undefined);
    expect(collectClientContext()).not.toHaveProperty("automatisiert");
  });

  test("DATENSCHUTZ: der Wert ist boolesch, nie ein Text oder eine Kennung", () => {
    setzeWebdriver(true);
    expect(typeof collectClientContext().automatisiert).toBe("boolean");
  });
});
