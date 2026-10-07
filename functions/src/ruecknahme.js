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

/* So lange wartet die Hilfe hoechstens auf die Freigabe des Platzes. Die
   Freigabe ist eine Transaktion auf dem EINEN Zaehlerdokument; unter Andrang
   kann Firestore dort lange auf die Sperre warten (counter.js, Zeitlimit am
   Einlass). Die Aufrufer haben kurze Zeitgrenzen und halten eine Antwort an
   einen wartenden Menschen zurueck. Nach dieser Zeit laeuft die Freigabe
   weiter, und eine Warnung sagt, dass nicht auf sie gewartet wurde.
   BLEIBT IM CODE — keine Stellschraube des Betriebs: Der Wert muss nur unter
   den Zeitgrenzen der Aufrufer bleiben (Statusabfrage, Aufraeumdienst). */
const FREIGABE_WARTEN_HOECHSTENS_MS = 5000;

/**
 * Loescht das Foto und gibt den Platz im Stundenfenster frei — in dieser
 * Reihenfolge. Wirft nie.
 *
 * ERST DAS FOTO (07.10.2026): Stand die Freigabe vorn und hing sie, blieb das
 * Foto eines schon verworfenen Auftrags liegen, sobald die Function darueber
 * an ihre Zeitgrenze kam — bis zur 2-Stunden-Loeschung und ohne
 * Protokollzeile, denn einen verworfenen Auftrag fasst der Aufraeumdienst
 * vorher nicht mehr an. Das Foto ist das, was nicht liegen bleiben darf. Ein
 * Platz, der nicht zurueckkommt, kostet hoechstens 60 Minuten Kapazitaet und
 * meldet sich selbst.
 *
 * @param {{ zaehlerStempel?: number, imagePath?: string|null }} auftrag
 *   die Marke des Einlasses und der Pfad des Fotos (ein Auftragsdokument
 *   passt so, wie es ist). Ohne Pfad wird nur der Platz freigegeben.
 * @returns {Promise<boolean>} ob das Foto weg ist (wie deleteImage: `true`
 *   auch, wenn es keines gab)
 */
async function belegtesFreigeben(auftrag) {
  /* deleteImage faengt seine Fehler selbst (liefert dann `false`). Sollte es
     je werfen, darf die Freigabe des Platzes nicht daran haengen. */
  const fotoWeg = auftrag.imagePath ? await Promise.resolve(deleteImage(auftrag.imagePath)).catch(() => false) : true;

  /* Die Zaehler-Funktion faengt ihre Fehler ebenfalls selbst und meldet sie
     (`release-slot-error`). */
  let uhr = null;
  const freigabe = Promise.resolve(releaseHourlySlot(auftrag.zaehlerStempel)).catch(() => {});
  const zuLange = new Promise((fertig) => {
    uhr = setTimeout(() => fertig("zu-lange"), FREIGABE_WARTEN_HOECHSTENS_MS);
  });
  if ((await Promise.race([freigabe, zuLange])) === "zu-lange") {
    console.warn(JSON.stringify({ severity: "WARNING", warning: "release-slot-nicht-abgewartet" }));
  }
  clearTimeout(uhr);
  return fotoWeg;
}

module.exports = { belegtesFreigeben, _FREIGABE_WARTEN_HOECHSTENS_MS: FREIGABE_WARTEN_HOECHSTENS_MS };
