import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiUrl, DIREKT, DIREKT_AKTIV, BETRIEBS_HOSTS, direktErlaubt } from "../js/api-basis.js";

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/* ── Direkt zum EU-Server, nicht über das Auslieferungsnetz ────────────────
 *
 * ANLASS 09.09.2026 (Standort-Inventar): Alle Aufrufe an `/api/…` liefen über
 * Firebase Hosting und damit durch einen Knoten des weltweiten
 * Auslieferungsnetzes — auch das Foto. Jetzt ruft der Browser die Dienste im
 * Betrieb direkt unter ihren Cloud-Run-Adressen in europe-west1 auf.
 *
 * Diese Tests halten drei Dinge fest:
 *   1. Die Wahl des Weges hängt nur am Hostnamen (Betrieb direkt, lokal relativ).
 *   2. Jede Adresse liegt in europe-west1 (Kürzel „ew" von Cloud Run).
 *   3. Die Sicherheitsrichtlinie in firebase.json erlaubt genau diese Hosts —
 *      nicht weniger (sonst blockt der Browser den Upload), nicht mehr (sonst
 *      steht ein Host in der CSP, den niemand mehr kennt).
 */

describe("apiUrl — Wahl des Weges", () => {
  it("im Betrieb geht der Aufruf direkt an Cloud Run, der Pfad bleibt", () => {
    for (const host of BETRIEBS_HOSTS) {
      expect(apiUrl("/api/enqueue", host)).toBe("https://enqueue-5ymhpdpqcq-ew.a.run.app/api/enqueue");
    }
    expect(apiUrl("/api/job-status", "malzi.me")).toBe("https://jobstatus-5ymhpdpqcq-ew.a.run.app/api/job-status");
  });

  it("lokal, im Emulator und in Tests bleibt der Aufruf relativ", () => {
    for (const host of ["localhost", "127.0.0.1", "0.0.0.0", "malzi.me.evil.example", ""]) {
      expect(apiUrl("/api/enqueue", host)).toBe("/api/enqueue");
      expect(direktErlaubt(host)).toBe(false);
    }
  });

  it("ohne Angabe entscheidet der Hostname der Seite (in Tests: localhost → relativ)", () => {
    expect(apiUrl("/api/stats")).toBe("/api/stats");
  });

  it("ein unbekannter Pfad wirft, statt still über das Auslieferungsnetz zu gehen", () => {
    expect(() => apiUrl("/api/admin/boost", "malzi.me")).toThrow(/unbekannter Pfad/);
    expect(() => apiUrl("/api/enqueu", "malzi.me")).toThrow();
  });

  it("der direkte Weg ist eingeschaltet (Rückweg: DIREKT_AKTIV=false, siehe RUNBOOK)", () => {
    expect(DIREKT_AKTIV).toBe(true);
  });
});

describe("Adressen — alle in europe-west1", () => {
  it("jeder Dienst hat eine Cloud-Run-Adresse mit dem Regionskürzel ew", () => {
    const pfade = Object.keys(DIREKT);
    expect(pfade).toEqual(["/api/enqueue", "/api/job-status", "/api/stats", "/api/errors", "/api/telemetry"]);
    for (const url of Object.values(DIREKT)) {
      expect(url).toMatch(/^https:\/\/[a-z]+-5ymhpdpqcq-ew\.a\.run\.app$/);
    }
  });

  /* OPS-2026-09-10-11: Der Waechter las frueher nur public/js/ — der
     Seitenstart in public/app.js rief /api/stats weiter relativ auf, also ueber
     das Auslieferungsnetz, und niemand merkte es. Jetzt die ganze Flaeche unter
     public/ (ausser den Tests), und jedes "/api/…"-Literal zaehlt, das nicht
     direkt an apiUrl geht — auch eines, das erst in einer Konstante landet. */
  function relativeApiLiterale(quelltext) {
    const zeilen = [];
    for (const m of quelltext.matchAll(/["'`]\/api\//g)) {
      const davor = quelltext.slice(Math.max(0, m.index - 40), m.index);
      if (/apiUrl\(\s*$/.test(davor)) continue;
      zeilen.push(quelltext.slice(0, m.index).split("\n").length);
    }
    return zeilen;
  }

  function jsDateien(verzeichnis) {
    const gefunden = [];
    for (const name of fs.readdirSync(verzeichnis)) {
      if (name === "__tests__") continue;
      const pfad = path.join(verzeichnis, name);
      if (fs.statSync(pfad).isDirectory()) gefunden.push(...jsDateien(pfad));
      else if (name.endsWith(".js")) gefunden.push(pfad);
    }
    return gefunden;
  }

  it("das Suchmuster schlägt an eingespielten Proben an und lässt apiUrl-Aufrufe durch (Positivkontrolle)", () => {
    for (const probe of [
      'fetch("/api/stats", { signal })',
      "fetchWithTimeout('/api/job-status?jobId=1', {}, 1)",
      "const ZIEL = `/api/errors`;",
      'navigator.sendBeacon("/api/telemetry", b)',
    ]) {
      expect(relativeApiLiterale(probe), probe).toHaveLength(1);
    }
    for (const probe of ['fetch(apiUrl("/api/stats"))', "apiUrl( '/api/enqueue' )"]) {
      expect(relativeApiLiterale(probe), probe).toEqual([]);
    }
  });

  it("jeder Aufruf unter public/ geht über apiUrl — kein relativer Weg auf /api/", () => {
    const tabelle = path.join(WURZEL, "public", "js", "api-basis.js");
    const dateien = jsDateien(path.join(WURZEL, "public")).filter((d) => d !== tabelle);
    /* Messmittel-Kontrolle: Eine Suche, die app.js nicht erreicht, war genau
       der blinde Fleck — und eine leere Suche waere wertlos gruen. */
    expect(dateien).toContain(path.join(WURZEL, "public", "app.js"));
    expect(dateien.length).toBeGreaterThan(20);
    const nackt = [];
    for (const datei of dateien) {
      const zeilen = relativeApiLiterale(fs.readFileSync(datei, "utf8"));
      if (zeilen.length) nackt.push(`${path.relative(WURZEL, datei)}:${zeilen.join(",")}`);
    }
    expect(nackt).toEqual([]);
  });
});

describe("Sicherheitsrichtlinie (firebase.json) und api-basis.js sind eine Liste", () => {
  const konfig = JSON.parse(fs.readFileSync(path.join(WURZEL, "firebase.json"), "utf8"));
  const csp = konfig.hosting.headers
    .find((h) => h.source === "**")
    .headers.find((h) => h.key === "Content-Security-Policy").value;
  const connectSrc = csp
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("connect-src"));
  const erlaubteHosts = connectSrc.split(/\s+/).slice(1);

  it("connect-src enthält jede Cloud-Run-Adresse aus api-basis.js", () => {
    for (const url of Object.values(DIREKT)) {
      expect(erlaubteHosts, `fehlt in connect-src: ${url}`).toContain(url);
    }
  });

  it("connect-src enthält keine run.app-Adresse, die api-basis.js nicht kennt", () => {
    const fremd = erlaubteHosts.filter((h) => h.includes("run.app") && !Object.values(DIREKT).includes(h));
    expect(fremd).toEqual([]);
  });

  it("connect-src bleibt sonst eng: 'self' und Nominatim, kein Platzhalter", () => {
    const rest = erlaubteHosts.filter((h) => !h.includes("run.app"));
    expect(rest).toEqual(["'self'", "https://nominatim.openstreetmap.org"]);
    expect(csp).not.toMatch(/\*\.run\.app|\*\.a\.run\.app/);
  });
});

/* ── Formularziele (SEC-2026-10-03-08) ─────────────────────────────────────
 *
 * `form-action` fällt nicht auf `default-src` zurück: Ohne eigene Regel darf
 * ein Formular in der Seite an JEDE Adresse senden. Die Seite setzt fremden
 * Text ein (die Antwort der KI); versagte dessen Maskierung einmal, hielte die
 * Richtlinie Skripte auf — ein eingeschleustes Formular mit fremdem Ziel nicht.
 *
 * Erlaubt ist die eigene Adresse ('self'), nicht 'none': Die Bestätigungsseite
 * der Verwaltung (functions/src/handle-admin.js) schickt ein echtes Formular an
 * /api/admin/… ab und kommt über dieselbe Adresse wie die Seite. Mit 'self'
 * bleibt sie in jedem Fall bedienbar — gleich, welche der beiden Richtlinien
 * aus firebase.json Hosting dort setzt.
 */
describe("Sicherheitsrichtlinie (firebase.json): Formularziele", () => {
  const konfig = JSON.parse(fs.readFileSync(path.join(WURZEL, "firebase.json"), "utf8"));
  const richtlinie = (quelle) =>
    konfig.hosting.headers.find((h) => h.source === quelle).headers.find((h) => h.key === "Content-Security-Policy")
      .value;
  const regel = (csp, name) =>
    csp
      .split(";")
      .map((s) => s.trim())
      .find((s) => s === name || s.startsWith(`${name} `));

  function htmlDateien(verzeichnis) {
    const gefunden = [];
    for (const name of fs.readdirSync(verzeichnis)) {
      if (name === "__tests__" || name === "lib") continue;
      const pfad = path.join(verzeichnis, name);
      if (fs.statSync(pfad).isDirectory()) gefunden.push(...htmlDateien(pfad));
      else if (name.endsWith(".html")) gefunden.push(pfad);
    }
    return gefunden;
  }

  /** Ziele aller Formulare und Absende-Knöpfe in einem HTML-Text. */
  const formularziele = (text) => [...text.matchAll(/\b(?:form)?action\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
  const fremd = (ziel) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ziel.trim());

  it("die Richtlinie der Seite nennt Formularziele: nur die eigene Adresse", () => {
    expect(regel(richtlinie("**"), "form-action")).toBe("form-action 'self'");
  });

  it("die eigene Richtlinie der Verwaltungsseite ebenso", () => {
    expect(regel(richtlinie("/api/admin/**"), "form-action")).toBe("form-action 'self'");
  });

  it("das Formular der Verwaltungsseite zielt auf die eigene Adresse — 'self' sperrt es nicht aus", () => {
    const quelltext = fs.readFileSync(path.join(WURZEL, "functions", "src", "handle-admin.js"), "utf8");
    const ziele = [...quelltext.matchAll(/<form\b[^>]*\baction="([^"]*)"/g)].map((m) => m[1]);
    /* Positivkontrolle: Ohne Treffer wäre die Schleife leer und grün. */
    expect(ziele.length).toBeGreaterThan(0);
    for (const ziel of ziele) expect(ziel).toMatch(/^\/api\/admin\//);
  });

  it("kein Formular unter public/ zielt auf eine fremde Adresse", () => {
    const seiten = htmlDateien(path.join(WURZEL, "public"));
    /* Positivkontrolle der Suche. */
    expect(seiten.length).toBeGreaterThanOrEqual(5);
    const treffer = [];
    for (const seite of seiten) {
      for (const ziel of formularziele(fs.readFileSync(seite, "utf8"))) {
        if (fremd(ziel)) treffer.push(`${path.relative(WURZEL, seite)}: ${ziel}`);
      }
    }
    expect(treffer).toEqual([]);
  });

  it("die Suche erkennt ein fremdes Formularziel (Gegenprobe)", () => {
    expect(formularziele('<form method="post" action="https://fremd.example/x">').filter(fremd)).toHaveLength(1);
    expect(formularziele('<button formaction="//fremd.example">').filter(fremd)).toHaveLength(1);
    expect(formularziele('<form action="/api/admin/boost">').filter(fremd)).toEqual([]);
  });
});
