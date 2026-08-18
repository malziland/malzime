/**
 * echtheit-pruefung.test.js — die Konsole in der Datenschutzerklärung.
 *
 * Sie rechnet im Browser nach, ob der ausgelieferte Stand dem offenen
 * Quelltext entspricht. Ein Prüfmittel, das immer grün meldet, wäre schlimmer
 * als keines: Es würde Vertrauen erzeugen, das es nicht deckt. Deshalb prüft
 * diese Datei BEIDE Richtungen — sie muss erkennen und sie muss durchlassen.
 */

import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const FINGERABDRUCK = join(process.cwd(), "public", "build-info.json");

/* Der im Repository liegende Fingerabdruck ist gegenueber dem Arbeitsstand
   IMMER veraltet — er entsteht erst beim Ausliefern neu. Ein Test, der gegen
   ihn prueft, waere je nach letzter Aenderung mal gruen und mal rot; genau das
   ist in der CI passiert (2 von 80 Dateien weichen ab).
   Der Test stellt sich seinen Pruefstand deshalb selbst her und raeumt danach
   auf. Damit misst er die Mechanik, nicht den Zufall. */
let urzustand;

test.beforeAll(() => {
  urzustand = readFileSync(FINGERABDRUCK, "utf8");
  execFileSync("node", ["scripts/build-info.mjs", "2099010101"], { cwd: process.cwd() });
});

test.afterAll(() => {
  if (urzustand) writeFileSync(FINGERABDRUCK, urzustand, "utf8");
});

async function laufen(page) {
  await page.click("#echtheitKnopf");
  await page.waitForFunction(() => document.getElementById("echtheitErgebnis").textContent.trim().length > 0, null, {
    timeout: 90000,
  });
  return page.locator("#echtheitErgebnis").innerText();
}

test.describe("Echtheits-Prüfung in der Seite", () => {
  test("meldet Deckungsgleichheit, wenn nichts verändert wurde", async ({ page }) => {
    await page.goto("/datenschutz.html");
    const ergebnis = await laufen(page);
    expect(ergebnis).toMatch(/stimmen mit dem offenen Quelltext überein/);
    /* Positivkontrolle: Ein Lauf über null Dateien wäre still grün. */
    const zahl = Number((ergebnis.match(/Alle (\d+) Dateien/) || [])[1] || 0);
    expect(zahl).toBeGreaterThan(50);
  });

  test("RÜCKBAUPROBE: erkennt eine veränderte Datei", async ({ page }) => {
    const original = readFileSync(FINGERABDRUCK, "utf8");
    try {
      /* Eine einzige Prüfsumme verfälschen — die Datei auf dem Server bleibt
         unangetastet. Genau dieser Fall soll auffallen. */
      const daten = JSON.parse(original);
      const ersteDatei = Object.keys(daten.dateien)[0];
      daten.dateien[ersteDatei] = "sha256:" + "0".repeat(64);
      writeFileSync(FINGERABDRUCK, JSON.stringify(daten, null, 2) + "\n", "utf8");

      await page.goto("/datenschutz.html");
      const ergebnis = await laufen(page);
      expect(ergebnis).toMatch(/weichen ab/);
      expect(await page.locator(".echtheit-zeile--problem").first().innerText()).toContain(ersteDatei);
    } finally {
      writeFileSync(FINGERABDRUCK, original, "utf8");
    }
  });

  test("ein Messproblem gilt NICHT als bestanden", async ({ page }) => {
    /* Fehlt der Fingerabdruck, darf nicht „alles in Ordnung" herauskommen. */
    await page.route("**/build-info.json", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/datenschutz.html");
    const ergebnis = await laufen(page);
    expect(ergebnis).toMatch(/gescheitert|Messproblem/);
    expect(ergebnis).not.toMatch(/stimmen mit dem offenen Quelltext überein/);
  });

  test("die Zeilen laufen nicht durch einen Ansage-Bereich", async ({ page }) => {
    /* 80 Ansagen in Folge machen die Seite für Screenreader unbenutzbar —
       am 17.08. ein echter Befund. Angesagt wird nur das Ergebnis. */
    await page.goto("/datenschutz.html");
    expect(await page.locator("#echtheitZeilen").getAttribute("aria-live")).toBe("off");
    expect(await page.locator("#echtheitErgebnis").getAttribute("aria-live")).toBe("polite");
  });

  test("der Knopf ist mit der Tastatur erreichbar", async ({ page }) => {
    /* Safari tabbt ohne „Vollzugriff Tastatur" nicht auf Buttons — deshalb
       trägt bei uns jedes Bedienelement ein ausdrückliches tabindex. */
    await page.goto("/datenschutz.html");
    expect(await page.locator("#echtheitKnopf").getAttribute("tabindex")).toBe("0");
  });
});
