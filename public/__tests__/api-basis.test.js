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

  it("jeder Aufruf im Client-Code geht über apiUrl — kein nacktes fetch auf /api/", () => {
    const js = path.join(WURZEL, "public", "js");
    const nackt = [];
    for (const datei of fs.readdirSync(js)) {
      if (!datei.endsWith(".js")) continue;
      const text = fs.readFileSync(path.join(js, datei), "utf8");
      const treffer = text.match(/fetch\(\s*["'`]\/api\//g);
      if (treffer) nackt.push(`${datei}: ${treffer.length}`);
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
