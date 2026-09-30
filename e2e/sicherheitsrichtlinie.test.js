import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Laufen die Browser-Tests wirklich unter der Sicherheitsrichtlinie der
 * Produktion? (Befund H-15, 30.09.2026)
 *
 * scripts/e2e-server.py setzt die Kopfzeilen aus firebase.json. Fiele das weg
 * — ein Rueckfall auf einen Server ohne Kopfzeilen, ein von Hand gestarteter
 * Server mit PW_REUSE=1 —, liefen alle anderen Tests weiter gruen, nur eben
 * ohne die Richtlinie, gegen die sie pruefen sollen. Dieser Test haelt die
 * Kopfzeile der ausgelieferten Seite gegen firebase.json.
 */

/* Wie in den anderen Browser-Tests: Playwright laeuft im Projektordner. */
const WURZEL = globalThis.process.cwd();

function sollKopfzeilen() {
  const firebase = JSON.parse(fs.readFileSync(path.join(WURZEL, "firebase.json"), "utf8"));
  const eintrag = firebase.hosting.headers.find((e) => e.source === "**");
  return Object.fromEntries(eintrag.headers.map((k) => [k.key.toLowerCase(), k.value]));
}

test("Startseite und HEIC-Dekoder kommen mit der Sicherheitsrichtlinie der Produktion", async ({ request }) => {
  const soll = sollKopfzeilen();
  /* Positivkontrolle: Ohne Sollwert waere der Vergleich leer und gruen. */
  expect(soll["content-security-policy"]).toContain("script-src");

  for (const adresse of ["/", "/index.html", "/lib/libheif/libheif.js"]) {
    const antwort = await request.get(adresse);
    expect(antwort.status(), adresse).toBe(200);
    const ist = antwort.headers();
    expect(ist["content-security-policy"], `${adresse}: Sicherheitsrichtlinie`).toBe(soll["content-security-policy"]);
    expect(ist["x-content-type-options"], `${adresse}: nosniff`).toBe(soll["x-content-type-options"]);
  }
});
