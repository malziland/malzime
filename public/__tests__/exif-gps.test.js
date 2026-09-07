/**
 * exif-gps.test.js — nur echte Koordinaten erreichen die Karte.
 *
 * BELEG (Fehlererfassung 05.09.2026): Viermal auf einem Android-Geraet brach
 * der Kartenaufbau mit "Invalid LatLng object: (NaN, NaN)" ab. Das Foto trug
 * GPS-Felder, aus denen die EXIF-Bibliothek keine Zahl machen konnte — und
 * die Pruefung "ist nicht null" liess NaN durch, weil NaN nun einmal nicht
 * null ist. Die Karte fehlte, der Rest der Analyse blieb.
 *
 * Abweichung zur Realbedingung, offen benannt: Der Test setzt beim Ergebnis
 * der EXIF-Bibliothek an, nicht beim Foto selbst. Der Fehlerbeleg (Leaflets
 * Meldung) zeigt eindeutig, dass NaN ankam; welche Bytes ihn erzeugt haben,
 * ist fuer die Abwehr gleichgueltig — sie faengt den Wert ab, nicht die
 * Datei. In jsdom laesst sich prepareImage ohnehin nicht bis zum Ende
 * fahren (kein Bild-Decoder, kein Canvas).
 */
import { describe, test, expect, vi } from "vitest";

vi.mock("../lib/exifr/lite.esm.mjs", () => ({
  default: { parse: vi.fn().mockResolvedValue(null) },
}));

import { gpsAusTags } from "../js/exif.js";

describe("gpsAusTags (05.09.2026)", () => {
  test("NaN in beiden Feldern → kein GPS", () => {
    expect(gpsAusTags({ latitude: NaN, longitude: NaN })).toBeNull();
  });

  test("NaN in EINEM Feld → kein GPS (halbe Koordinaten gibt es nicht)", () => {
    expect(gpsAusTags({ latitude: 48.3, longitude: NaN })).toBeNull();
    expect(gpsAusTags({ latitude: NaN, longitude: 14.3 })).toBeNull();
  });

  test.each([
    [{ latitude: undefined, longitude: undefined }, "beide fehlen"],
    [{ latitude: null, longitude: 14.3 }, "eines ist null"],
    [{}, "keine GPS-Felder"],
    [null, "keine Tags"],
  ])("%p → kein GPS (%s)", (tags) => {
    expect(gpsAusTags(tags)).toBeNull();
  });

  test.each([
    [{ latitude: 95, longitude: 14.3 }, "Breite ueber 90"],
    [{ latitude: 48.3, longitude: -190 }, "Laenge unter -180"],
    [{ latitude: Infinity, longitude: 14.3 }, "unendlich"],
  ])("%p → kein GPS (%s)", (tags) => {
    expect(gpsAusTags(tags)).toBeNull();
  });

  test("Positivkontrolle: echte Koordinaten kommen unveraendert durch", () => {
    expect(gpsAusTags({ latitude: 48.30694, longitude: 14.28583 })).toEqual({
      latitude: 48.30694,
      longitude: 14.28583,
    });
  });

  test("Randwerte sind erlaubt: Pol und Datumsgrenze", () => {
    expect(gpsAusTags({ latitude: -90, longitude: 180 })).toEqual({ latitude: -90, longitude: 180 });
  });
});
