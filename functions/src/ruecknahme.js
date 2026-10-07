"use strict";

/**
 * ruecknahme.js — zurueckgeben, was ein Auftrag belegt, der nie analysiert wird.
 *
 * Jeder eingelassene Auftrag belegt einen Platz im Stundenfenster
 * (Kostenbremse) und meist ein Foto im Zwischenspeicher. Wird er
 * zurueckgenommen — verlassen, zu spaet gekommen, nicht speicherbar, nicht
 * einreihbar —, kommt beides zurueck.
 *
 * DIE EINE STELLE dafuer (STRUCT-2026-10-03-37): Vorher stand die Freigabe an
 * sechs Stellen in drei Dateien, an vier davon nicht abgewartet, jede mit
 * etwas anderer Reihenfolge. Was nach der Antwort einer Function noch laeuft,
 * kommt vielleicht nie an (SECURITY-MODEL, "Jeder eingelassene Auftrag zaehlt
 * genau einmal") — ein verlorener Platz bleibt bis zu 60 Minuten belegt.
 * Ausserhalb dieser Datei ruft niemand `releaseHourlySlot` direkt
 * (freigabe-ueber-die-hilfe.test.js).
 */

const { releaseHourlySlot } = require("./counter");
const { deleteImage } = require("./queue-storage");

/**
 * Gibt den Platz im Stundenfenster frei und loescht das Foto — in dieser
 * Reihenfolge, beides abgewartet. Wirft nie.
 *
 * @param {{ zaehlerStempel?: number, imagePath?: string|null }} auftrag
 *   die Marke des Einlasses und der Pfad des Fotos (ein Auftragsdokument
 *   passt so, wie es ist). Ohne Pfad wird nur der Platz freigegeben.
 * @returns {Promise<boolean>} ob das Foto weg ist (wie deleteImage: `true`
 *   auch, wenn es keines gab)
 */
async function belegtesFreigeben(auftrag) {
  /* Die Zaehler-Funktion faengt ihre Fehler selbst und meldet sie
     (`release-slot-error`). Sollte sie je werfen, darf das Loeschen des Fotos
     nicht daran haengen. */
  await releaseHourlySlot(auftrag.zaehlerStempel).catch(() => {});
  return auftrag.imagePath ? deleteImage(auftrag.imagePath) : true;
}

module.exports = { belegtesFreigeben };
