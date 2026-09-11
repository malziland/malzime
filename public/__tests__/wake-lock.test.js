import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/* Bildschirm wach halten während der Analyse (js/wake-lock.js). Bis 10.09.2026
   lag dieser Teil ungetestet in api.js; die Tests halten das Verhalten fest,
   das beim Auslagern erhalten bleiben musste:
   - nur die ERSTE Anfrage zählt (iOS verweigert eine zweite nach `await`),
   - der Status für die Telemetrie nennt Erfolg, fehlende API oder den Grund
     der Verweigerung,
   - Freigeben erlaubt der nächsten Analyse eine neue Anfrage. */

let modul;
let ursprung;

beforeEach(async () => {
  vi.resetModules();
  ursprung = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
  modul = await import("../js/wake-lock.js");
});

afterEach(() => {
  if (ursprung) Object.defineProperty(navigator, "wakeLock", ursprung);
  else delete navigator.wakeLock;
});

function setzeWakeLock(request) {
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
}

describe("wake-lock", () => {
  it("vor jeder Anfrage steht der Status auf not-attempted", () => {
    expect(modul.wakeLockStatus()).toBe("not-attempted");
  });

  it("ohne die Browser-Schnittstelle meldet der Status unsupported", async () => {
    delete navigator.wakeLock;
    expect("wakeLock" in navigator).toBe(false);
    await modul.acquireWakeLock();
    expect(modul.wakeLockStatus()).toBe("unsupported");
  });

  it("eine erfolgreiche Anfrage meldet acquired", async () => {
    const request = vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue() });
    setzeWakeLock(request);
    await modul.acquireWakeLock();
    expect(request).toHaveBeenCalledWith("screen");
    expect(modul.wakeLockStatus()).toBe("acquired");
  });

  it("eine Verweigerung nennt den Fehlernamen und bricht nichts ab", async () => {
    const fehler = Object.assign(new Error("nein"), { name: "NotAllowedError" });
    setzeWakeLock(vi.fn().mockRejectedValue(fehler));
    await expect(modul.acquireWakeLock()).resolves.toBeUndefined();
    expect(modul.wakeLockStatus()).toBe("denied:NotAllowedError");
  });

  it("nur die erste Anfrage zählt, eine zweite überschreibt den Status nicht", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ release: vi.fn().mockResolvedValue() })
      .mockRejectedValueOnce(Object.assign(new Error("zu spaet"), { name: "NotAllowedError" }));
    setzeWakeLock(request);
    await modul.acquireWakeLock();
    await modul.acquireWakeLock();
    expect(request).toHaveBeenCalledTimes(1);
    expect(modul.wakeLockStatus()).toBe("acquired");
  });

  it("Freigeben gibt die Sperre zurück und erlaubt der nächsten Analyse eine neue Anfrage", async () => {
    const release = vi.fn().mockResolvedValue();
    const request = vi.fn().mockResolvedValue({ release });
    setzeWakeLock(request);
    await modul.acquireWakeLock();
    modul.releaseWakeLock();
    expect(release).toHaveBeenCalledTimes(1);
    await modul.acquireWakeLock();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("Freigeben ohne gehaltene Sperre wirft nicht", () => {
    expect(() => modul.releaseWakeLock()).not.toThrow();
  });
});
