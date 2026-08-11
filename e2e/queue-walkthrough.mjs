/* Diagnose-/Screenshot-Lauf für den Queue-Durchklick im Emulator.
   Kein Test — ein Werkzeug: füllt zuerst die Warteschlange mit Mock-Jobs,
   fährt dann den Browser durch die Queue-UX und schiesst Screenshots.
   So wird der Warte-Bildschirm MIT echter Position sichtbar.
   Aufruf aus dem Repo-Wurzelverzeichnis bei laufendem Emulator:
   node e2e/queue-walkthrough.mjs */

import { chromium } from "@playwright/test";
import fs from "fs";

const BASE = "http://localhost:5050";
const FUNCTIONS = "http://127.0.0.1:5001/malzime/europe-west1";
const SHOT_DIR = "/tmp/malzime-shots";
const FILL_COUNT = 20;
fs.mkdirSync(SHOT_DIR, { recursive: true });

/* Minimaler gültiger JPEG-Puffer für die Füll-Jobs. */
const IMAGE_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]).toString("base64");

async function fillQueue(n) {
  const reqs = Array.from({ length: n }, () =>
    fetch(`${FUNCTIONS}/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost:5050" },
      body: JSON.stringify({ imageBase64: IMAGE_B64, mimeType: "image/jpeg", lang: "de" }),
    })
      .then((r) => r.ok)
      .catch(() => false)
  );
  const ok = (await Promise.all(reqs)).filter(Boolean).length;
  console.log(`Warteschlange gefüllt: ${ok}/${n} Mock-Jobs eingereiht`);
}

const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

console.log(`→ ${BASE}`);
await page.goto(BASE).catch((e) => console.log("goto:", e.message));
await page.screenshot({ path: `${SHOT_DIR}/01-landing.png`, fullPage: true });

/* Erst die Warteschlange füllen, DANN als Nutzer hochladen — so landet der
   eigene Job hinter den Füll-Jobs und bekommt eine echte Position. */
await fillQueue(FILL_COUNT);
await page.waitForTimeout(2800);
console.log("→ Foto hochladen (landet hinter den Füll-Jobs)");
await page.setInputFiles("#fileInput", "public/img/demo/demo-selfie.jpg");

/* v3.0.2: Die Analyse startet direkt bei der Foto-Wahl — es gibt kein
   Hinweis-Pop-up mehr. Gewartet wird nur noch auf Warteschlange + Ergebnis. */
let resultSeen = false;
let positionShot = false;
for (let i = 1; i <= 60; i++) {
  await page.waitForTimeout(2000);
  if (await page.locator("#simulation .verdict").count()) {
    resultSeen = true;
    break;
  }
  const scanText = await page.locator("#scanText").textContent().catch(() => "");
  console.log(`  t≈${i * 2}s  #scanText: "${scanText}"`);
  /* Den ersten Warteschlangen-Zustand als Beweis-Screenshot festhalten. */
  if (!positionShot && /Warteschlange|Queue|vor dir|ahead/.test(scanText || "")) {
    await page.screenshot({ path: `${SHOT_DIR}/02-warteschlange.png`, fullPage: true });
    positionShot = true;
    console.log("  → Warteschlangen-Screenshot gespeichert: 02-warteschlange.png");
  }
}

if (resultSeen) {
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOT_DIR}/03-result.png`, fullPage: true });
  console.log("Ergebnis gerendert.");
}

console.log(positionShot ? "\n✓ Warteschlangen-Position wurde sichtbar" : "\n✗ Keine Warteschlangen-Position gesehen");
console.log("Konsole (letzte 6):");
logs.slice(-6).forEach((l) => console.log("  " + l));

await browser.close();
console.log(`\nScreenshots: ${SHOT_DIR}`);
