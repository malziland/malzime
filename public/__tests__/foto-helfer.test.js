/**
 * foto-helfer.test.js — Ausweichweg fuer Fotos, die Chrome auf Android nicht
 * lesen laesst (09.11.2026, am Pruefgeraet nachgestellt; Begruendung in
 * public/foto-helfer-sw.js).
 *
 * Geprueft wird vor allem die Datenschutz-Zusage: Das Foto verlaesst das
 * Geraet nie. Die Seite schickt nur, wenn die Hilfsdatei sie steuert — sonst
 * ginge die Anfrage ans Netz. Dazu: Die Hilfsdatei meldet sich gleich wieder
 * ab (kein dauerhafter Speicher), und sie selbst beantwortet nur ihre eine
 * Adresse und reicht nichts weiter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
import { leseUeberHelfer, starteFotoHelfer } from "../js/foto-helfer.js";

const echtesNavigatorSw = Object.getOwnPropertyDescriptor(globalThis.navigator, "serviceWorker");

function setzeSw(wert) {
  Object.defineProperty(globalThis.navigator, "serviceWorker", { configurable: true, value: wert });
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  if (echtesNavigatorSw) Object.defineProperty(globalThis.navigator, "serviceWorker", echtesNavigatorSw);
  else delete globalThis.navigator.serviceWorker;
});

describe("leseUeberHelfer: das Foto verlaesst das Geraet nie", () => {
  it("ohne steuernde Hilfsdatei: KEINE Anfrage, Stichwort kein-helfer", async () => {
    setzeSw({ register: vi.fn(), controller: null });
    const ergebnis = await leseUeberHelfer(new Blob(["x"]));
    expect(ergebnis).toEqual({ bytes: null, ergebnis: "kein-helfer" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("ohne Service-Worker-Unterstuetzung: KEINE Anfrage", async () => {
    setzeSw(undefined);
    const ergebnis = await leseUeberHelfer(new Blob(["x"]));
    expect(ergebnis.ergebnis).toBe("kein-helfer");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("mit steuernder Hilfsdatei: POST an die eigene Adresse, Bytes zurueck", async () => {
    setzeSw({ register: vi.fn(), controller: {} });
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new globalThis.Headers(),
      arrayBuffer: async () => bytes,
    });
    const ergebnis = await leseUeberHelfer(new Blob(["x"]));
    expect(ergebnis).toEqual({ bytes, ergebnis: "ok" });
    const [adresse, optionen] = globalThis.fetch.mock.calls[0];
    expect(adresse).toBe("https://foto-lokal.invalid/foto");
    expect(optionen.method).toBe("POST");
    expect(optionen.body).toBeInstanceOf(FormData);
  });

  it("meldet die Hilfsdatei einen Fehler, kommt nur das Stichwort zurueck", async () => {
    setzeSw({ register: vi.fn(), controller: {} });
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 422,
      headers: new globalThis.Headers({ "X-Foto-Fehler": "NotReadableError" }),
    });
    expect(await leseUeberHelfer(new Blob(["x"]))).toEqual({ bytes: null, ergebnis: "status-422:NotReadableError" });
  });

  it("leere Antwort zaehlt nicht als Foto", async () => {
    setzeSw({ register: vi.fn(), controller: {} });
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new globalThis.Headers(),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    expect((await leseUeberHelfer(new Blob(["x"]))).ergebnis).toBe("leer");
  });
});

describe("starteFotoHelfer: kein dauerhafter Speicher", () => {
  it("meldet die Hilfsdatei an und gleich wieder ab, sobald sie steuert", async () => {
    const unregister = vi.fn(async () => true);
    const register = vi.fn(async () => ({ unregister }));
    setzeSw({ register, controller: {}, addEventListener: vi.fn() });
    expect(await starteFotoHelfer()).toBe("bereit");
    expect(register).toHaveBeenCalledWith("/foto-helfer-sw.js", { scope: "/" });
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("wartet auf die Steuerung, bevor sie abmeldet", async () => {
    const unregister = vi.fn(async () => true);
    let wechsel;
    const sw = {
      register: vi.fn(async () => ({ unregister })),
      controller: null,
      addEventListener: vi.fn((art, fn) => {
        if (art === "controllerchange") wechsel = fn;
      }),
    };
    setzeSw(sw);
    const lauf = starteFotoHelfer();
    await new Promise((r) => setTimeout(r, 0));
    expect(unregister).not.toHaveBeenCalled();
    sw.controller = {};
    wechsel();
    expect(await lauf).toBe("bereit");
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  /* 09.11.2026, am Pruefgeraet gemessen: Im zweiten Tab steuert die Hilfsdatei
     nicht von selbst; ohne Nachricht und ohne Frist blieb sie dauerhaft
     angemeldet. */
  it("zweiter Tab: bittet um Uebernahme und meldet nach der Frist IMMER ab", async () => {
    vi.useFakeTimers();
    const unregister = vi.fn(async () => true);
    const postMessage = vi.fn();
    setzeSw({
      register: vi.fn(async () => ({ unregister })),
      controller: null,
      ready: Promise.resolve({ active: { postMessage } }),
      addEventListener: vi.fn(),
    });
    const lauf = starteFotoHelfer();
    await vi.advanceTimersByTimeAsync(4999);
    expect(unregister).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await lauf).toBe("nicht-gesteuert");
    expect(postMessage).toHaveBeenCalledWith("uebernehmen");
    expect(unregister).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("scheitert register nicht, aber das Warten, wird trotzdem abgemeldet", async () => {
    const unregister = vi.fn(async () => true);
    setzeSw({
      register: vi.fn(async () => ({ unregister })),
      controller: null,
      ready: Promise.resolve({ active: { postMessage: vi.fn() } }),
      addEventListener: vi.fn(() => {
        throw new Error("kaputt");
      }),
    });
    expect(await starteFotoHelfer()).toBe("fehler");
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("ohne Service-Worker-Unterstuetzung passiert nichts", async () => {
    setzeSw(undefined);
    expect(await starteFotoHelfer()).toBe("kein-sw");
  });
});

describe("foto-helfer-sw.js: beantwortet nur die eine Adresse und reicht nichts weiter", () => {
  function ladeSw() {
    const quelle = readFileSync(join(HIER, "..", "foto-helfer-sw.js"), "utf8");
    const hoerer = {};
    const fakeSelf = {
      location: { origin: "https://malzi.me" },
      addEventListener: (art, fn) => (hoerer[art] = fn),
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    };
    new Function("self", "URL", "Response", quelle)(fakeSelf, URL, Response);
    return hoerer;
  }

  function anfrage(url, methode, datei) {
    return {
      url,
      method: methode,
      formData: async () => {
        const fd = new FormData();
        if (datei) fd.append("foto", datei);
        return fd;
      },
    };
  }

  it("POST an die nie erreichbare Adresse: antwortet mit genau den Bytes der Datei", async () => {
    const { fetch: abfangen } = ladeSw();
    let antwort;
    abfangen({
      request: anfrage("https://foto-lokal.invalid/foto", "POST", new Blob([new Uint8Array([7, 8, 9])])),
      respondWith: (p) => (antwort = p),
    });
    const r = await antwort;
    expect(r.status).toBe(200);
    expect(Array.from(new Uint8Array(await r.arrayBuffer()))).toEqual([7, 8, 9]);
  });

  it("Nachricht uebernehmen: steuert auch einen weiteren Tab (clients.claim)", () => {
    const quelle = readFileSync(join(HIER, "..", "foto-helfer-sw.js"), "utf8");
    const hoerer = {};
    const claim = vi.fn(async () => {});
    const fakeSelf = {
      location: { origin: "https://malzi.me" },
      addEventListener: (art, fn) => (hoerer[art] = fn),
      skipWaiting: vi.fn(),
      clients: { claim },
    };
    new Function("self", "URL", "Response", quelle)(fakeSelf, URL, Response);
    const waitUntil = vi.fn();
    hoerer.message({ data: "anderes", waitUntil });
    expect(claim).not.toHaveBeenCalled();
    hoerer.message({ data: "uebernehmen", waitUntil });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("jede andere Anfrage bleibt unberuehrt", () => {
    const { fetch: abfangen } = ladeSw();
    const respondWith = vi.fn();
    abfangen({ request: anfrage("https://malzi.me/api/enqueue", "POST"), respondWith });
    abfangen({ request: anfrage("https://foto-lokal.invalid/foto", "GET"), respondWith });
    abfangen({ request: anfrage("https://malzi.me/foto", "POST"), respondWith });
    abfangen({ request: anfrage("https://malzi.me/__foto-lokal", "POST"), respondWith });
    abfangen({ request: anfrage("https://andere.example/__foto-lokal", "POST"), respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it("ohne Foto im Formular: Fehlerantwort, nie Weitergabe ans Netz", async () => {
    const { fetch: abfangen } = ladeSw();
    let antwort;
    abfangen({ request: anfrage("https://foto-lokal.invalid/foto", "POST"), respondWith: (p) => (antwort = p) });
    expect((await antwort).status).toBe(400);
  });
});

describe("Auswahl: erst lesen, dann die Datei anfassen", () => {
  function koerper(datei, kopf) {
    const quelle = readFileSync(join(HIER, "..", datei), "utf8");
    const start = quelle.indexOf(kopf);
    expect(start, kopf).toBeGreaterThan(-1);
    return quelle.slice(start, quelle.indexOf("\n}\n", start));
  }

  it("handleNewFile fasst die Datei selbst nicht an, sondern startet das Lesen", () => {
    const k = koerper("app.js", "function handleNewFile(file)");
    expect(k).toContain("lesenUndVorschau(file)");
    for (const zugriff of ["file.size", "file.lastModified", "file.type", "createObjectURL(file)", "zeitsprungArt("]) {
      expect([zugriff, k.includes(zugriff)]).toEqual([zugriff, false]);
    }
  });

  it("lesenUndVorschau liest zuerst; Groesse, Zeit und Vorschau kommen erst danach", () => {
    const k = koerper("js/foto-auswahl.js", "export function lesenUndVorschau(file)");
    const lesen = k.indexOf("leseFoto(file");
    expect(lesen).toBeGreaterThan(-1);
    for (const zugriff of ["file.size", "file.lastModified", "createObjectURL(", "zeitsprungArt("]) {
      const stelle = k.indexOf(zugriff);
      expect([zugriff, stelle > lesen]).toEqual([zugriff, true]);
    }
    expect(k).not.toContain("createObjectURL(file)");
  });
});
