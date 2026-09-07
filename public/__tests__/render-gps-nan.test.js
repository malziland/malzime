/**
 * render-gps-nan.test.js — die Karte bricht bei NaN nicht mehr ab.
 *
 * BELEG (Fehlererfassung 05.09.2026, viermal Android): "Invalid LatLng
 * object: (NaN, NaN)" aus dem Kartenaufbau. Die Karte fehlte, und jede
 * dieser vier Analysen schickte eine Fehlermeldung an den Server.
 *
 * Hier laeuft das ECHTE Leaflet aus dem Repo — genau die Bibliothek, die im
 * Browser geworfen hat. Eine Attrappe koennte den Wurf nur nachspielen; die
 * Messmittel-Probe unten belegt, dass Leaflet bei NaN wirklich wirft, damit
 * ein gruener Test nicht an einem stummen Leaflet liegt.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setupDOM } from "./setup.js";

vi.mock("../js/i18n.js", () => ({
  t: (key) => key,
  getLanguage: () => "de",
  initI18n: () => Promise.resolve(),
  applyTranslations: () => {},
}));
vi.mock("../js/error-logger.js", () => ({ logClientError: vi.fn() }));

async function ladeLeaflet() {
  if (!globalThis.L) await import("../lib/leaflet/leaflet.js");
  return globalThis.L;
}

function ergebnisMit(exif) {
  return {
    profiles: { normal: { categories: {}, profileText: "Test" }, boost: null },
    privacyRisks: [],
    exif,
    meta: { requestId: "t", mode: "multimodal" },
  };
}

describe("Karte bei GPS-Werten, die keine Zahlen sind (05.09.2026)", () => {
  let elements;
  let logClientError;
  let L;

  beforeEach(async () => {
    /* dom.js bindet seine Elemente beim ersten Import. Ohne frisches Laden
       zeigte es nach dem naechsten setupDOM auf verwaiste Knoten, und Leaflet
       fand seinen Behaelter nicht ("Map container not found") — der Test
       haette dann etwas anderes gemessen als den Fehler vom 05.09. */
    vi.resetModules();
    setupDOM();
    L = await ladeLeaflet();
    elements = (await import("../js/dom.js")).elements;
    logClientError = (await import("../js/error-logger.js")).logClientError;
    logClientError.mockClear();
    const { state } = await import("../js/state.js");
    state.pendingGeocode = null;
    state.geocodeCache = null;
    state.gpsMapInstance = null;
  });

  async function karteAufbauen(exif) {
    const { renderCurrentMode } = await import("../js/render.js");
    renderCurrentMode(ergebnisMit(exif));
    /* Der Kartenaufbau wartet auf das (hier leere) Geocoding — ein Takt reicht. */
    await new Promise((r) => setTimeout(r, 0));
  }

  it("Messmittel-Probe: das echte Leaflet wirft bei NaN wirklich", () => {
    expect(L).toBeDefined();
    expect(() => L.latLng(NaN, NaN)).toThrow(/Invalid LatLng/);
  });

  it("Positivkontrolle: mit echten Koordinaten entsteht die Karte, ohne Fehlermeldung", async () => {
    await karteAufbauen({ gpsLatitude: 48.30694, gpsLongitude: 14.28583 });
    expect(elements.gpsMap.innerHTML).toContain("gpsMapLeaflet");
    expect(elements.gpsMap.innerHTML).toContain("48.30694");
    expect(logClientError).not.toHaveBeenCalled();
  });

  it("NaN/NaN: die Karte bleibt weg, und es geht KEINE Fehlermeldung raus", async () => {
    await karteAufbauen({ gpsLatitude: NaN, gpsLongitude: NaN });
    expect(logClientError).not.toHaveBeenCalled();
    expect(elements.gpsMap.innerHTML).toBe("");
  });

  it("nur EIN Wert kaputt: ebenfalls keine Karte, keine Fehlermeldung", async () => {
    await karteAufbauen({ gpsLatitude: 48.30694, gpsLongitude: NaN });
    expect(logClientError).not.toHaveBeenCalled();
    expect(elements.gpsMap.innerHTML).toBe("");
  });
});
