/**
 * api-basis.js — die EINE Stelle, an der steht, wohin der Browser unsere
 * Server-Schnittstellen ruft.
 *
 * WARUM (09.09.2026, Standort-Inventar): Bis dahin gingen alle Aufrufe an
 * `/api/…` über Firebase Hosting, und Hosting ist ein weltweites
 * Auslieferungsnetz (Fastly). Damit lief auch das komprimierte Foto durch den
 * jeweils nächsten Knoten dieses Netzes, bevor es den Server in Belgien
 * erreichte. Die Zusage „alles auf EU-Servern" gilt aber ohne Umweg. Deshalb
 * ruft der Browser die Dienste jetzt DIREKT unter ihren Cloud-Run-Adressen in
 * `europe-west1` auf. Nur die Seite selbst (HTML, CSS, JS, Bilder) kommt
 * weiter aus dem Auslieferungsnetz — sie enthält keine Nutzerdaten.
 *
 * WIE: Im Betrieb (Hostnamen unten) wird die Cloud-Run-Adresse vorangestellt,
 * der Pfad bleibt derselbe. Lokal, im Emulator und in den Tests (localhost)
 * bleibt der Aufruf relativ — dort gibt es kein Auslieferungsnetz, und die
 * E2E-Tests fangen die Pfade unter `api/` ab, was beide Formen trifft.
 *
 * RÜCKWEG (RUNBOOK, Hebel 5a): `DIREKT_AKTIV` auf `false`, nur Hosting neu
 * ausliefern — die Hosting-Umleitungen für `/api/…` in firebase.json bleiben
 * genau dafür bestehen. Kein Function-Deploy nötig.
 *
 * EINE QUELLE: Die Adressen stehen nur hier. Die Sicherheitsrichtlinie
 * (`connect-src` in firebase.json) muss dieselben Hosts erlauben — der Test
 * `public/__tests__/api-basis.test.js` vergleicht beide Listen und wird rot,
 * sobald sie auseinanderlaufen. CORS erlaubt auf dem Server nur unsere eigenen
 * Ursprünge (functions/src/domains.js).
 */

export const DIREKT_AKTIV = true;

/* Hostnamen, unter denen die Seite im Betrieb läuft. Alle anderen (localhost,
   127.0.0.1, Emulator) bekommen den relativen Weg. */
export const BETRIEBS_HOSTS = ["malzi.me", "www.malzi.me", "malzime.web.app", "malzime.firebaseapp.com"];

/* Pfad → Cloud-Run-Adresse des Dienstes (Region europe-west1, Kürzel „ew"). */
export const DIREKT = Object.freeze({
  "/api/enqueue": "https://enqueue-5ymhpdpqcq-ew.a.run.app",
  "/api/job-status": "https://jobstatus-5ymhpdpqcq-ew.a.run.app",
  "/api/stats": "https://stats-5ymhpdpqcq-ew.a.run.app",
  "/api/errors": "https://errors-5ymhpdpqcq-ew.a.run.app",
  "/api/telemetry": "https://telemetry-5ymhpdpqcq-ew.a.run.app",
});

export function direktErlaubt(hostname) {
  const h = hostname !== undefined ? hostname : typeof location !== "undefined" ? location.hostname : "";
  return DIREKT_AKTIV && BETRIEBS_HOSTS.includes(h);
}

/**
 * Liefert die Adresse für einen Schnittstellen-Pfad. Unbekannte Pfade sind
 * ein Programmierfehler und werfen — sonst ginge ein Aufruf still über das
 * Auslieferungsnetz, und niemand merkte es.
 */
export function apiUrl(pfad, hostname) {
  if (!(pfad in DIREKT)) throw new Error(`api-basis: unbekannter Pfad ${pfad}`);
  return direktErlaubt(hostname) ? DIREKT[pfad] + pfad : pfad;
}
