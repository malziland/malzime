#!/usr/bin/env node
/**
 * vorschau.mjs — lokale Vorschau, die sich wie die ausgelieferte Seite verhaelt.
 *
 * ANLASS (2026-08-19): Zum Ansehen lief hier ein `python3 -m http.server`. Der
 * liefert nur Dateien aus — `/impressum` ergab 404, weil die saubere Adresse
 * erst durch die Rewrites von Firebase Hosting entsteht. Wer lokal prueft,
 * prueft dann etwas anderes als das, was live steht.
 *
 * Dieser Server liest die Rewrites AUS firebase.json. Es gibt damit keine
 * zweite Liste, die veralten kann: Kommt eine Seite dazu, kennt die Vorschau
 * sie im selben Moment wie die Auslieferung.
 *
 * Aufruf:  node scripts/vorschau.mjs [port]     (Vorgabe: 8099)
 *
 * Bewusst NICHT enthalten: die Weiterleitung von /api/* auf die Functions.
 * Wer Schnittstellen braucht, nimmt den Emulator — hier geht es ums Aussehen.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";

const WURZEL = resolve(process.cwd(), "public");
const PORT = Number(process.argv[2]) || 8099;

const TYPEN = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

/* Die Regeln aus firebase.json — dieselbe Quelle wie die Auslieferung. */
function regelnLesen() {
  const j = JSON.parse(readFileSync("firebase.json", "utf8"));
  const h = Array.isArray(j.hosting) ? j.hosting[0] : j.hosting;
  const rewrites = (h.rewrites || []).filter((r) => r.destination);
  /* Positivkontrolle: Faende die Suche keine Regeln, liefe der Server still
     als gewoehnlicher Dateiserver — also genau als das, was hier ersetzt
     werden soll. Dann lieber abbrechen. */
  if (rewrites.length < 2) {
    console.error("FEHLER: in firebase.json keine Rewrites gefunden — die Vorschau waere wertlos.");
    process.exit(2);
  }
  return rewrites;
}

const REGELN = regelnLesen();

function zielFuer(pfad) {
  for (const r of REGELN) {
    if (r.source === pfad) return r.destination;
    if (r.source === "**") return r.destination;
  }
  return null;
}

createServer((req, res) => {
  const pfad = decodeURIComponent(req.url.split("?")[0]);

  /* 1. Gibt es die Datei wirklich? Dann direkt ausliefern. */
  let datei = join(WURZEL, pfad);
  if (pfad === "/") datei = join(WURZEL, "index.html");

  if (!existsSync(datei) || statSync(datei).isDirectory()) {
    /* 2. Sonst die Rewrite-Regeln, in der Reihenfolge von firebase.json. */
    const ziel = zielFuer(pfad);
    if (!ziel) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`404 — weder Datei noch Rewrite fuer ${pfad}`);
      return;
    }
    datei = join(WURZEL, ziel);
  }

  if (!existsSync(datei)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`404 — Ziel fehlt: ${datei}`);
    return;
  }

  res.writeHead(200, {
    "content-type": TYPEN[extname(datei)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(readFileSync(datei));
}).listen(PORT, () => {
  console.log(`Vorschau auf http://localhost:${PORT}/  (Wurzel: ${WURZEL})`);
  console.log(`${REGELN.length} Regeln aus firebase.json uebernommen:`);
  for (const r of REGELN) console.log(`  ${r.source}  →  ${r.destination}`);
});
