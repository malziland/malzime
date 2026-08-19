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
 * /api/stats wird beantwortet, /api/* sonst nicht. Grund: Ohne diese eine
 * Antwort entsteht der SPRACHUMSCHALTER nicht — app.js liest das Merkmal von
 * dort. In der ersten Fassung fiel /api/stats in die Auffang-Regel und lieferte
 * HTML; der Browser konnte es nicht lesen, und der Umschalter fehlte lautlos.
 * Der Nutzer hat das gefunden, nicht ich: "der Sprachumschalter ist gar nicht
 * da ... irgendwas stimmt mit deinen Angaben nicht."
 *
 * Genau das ist der Sinn einer Vorschau — sie muss zeigen, was live steht.
 * Verschluckt sie ein sichtbares Element, ist sie schlechter als gar keine.
 *
 * Alles andere unter /api/ bleibt draussen und antwortet ausdruecklich mit 501,
 * damit niemand hier eine Analyse zu starten versucht und sich wundert. Wer
 * Schnittstellen braucht, nimmt den Emulator.
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

/* Eine plausible Antwort, ausdruecklich als Vorschau gekennzeichnet. Die Werte
   sind erfunden — es geht um das Aussehen, nicht um Zahlen. */
const STATS_VORSCHAU = {
  current: { count: 6, limit: 500, limitActive: false, retryAfterSeconds: 0, hourlyTotal: 6 },
  totals: { today: 19, week: 26, month: 172, year: 5129, allTime: 5129 },
  maintenance: { enabled: false, message: "" },
  realitaetsCheck: { eingaben: 8, mittelProzent: null },
  useQueue: true,
  sprachumschalter: true,
  vorschau: true,
};

createServer((req, res) => {
  const pfad = decodeURIComponent(req.url.split("?")[0]);

  if (pfad === "/api/stats") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(STATS_VORSCHAU));
    return;
  }
  if (pfad.startsWith("/api/")) {
    res.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
    res.end(`501 — ${pfad} gibt es in der Vorschau nicht. Fuer Schnittstellen den Emulator nehmen.`);
    return;
  }

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
