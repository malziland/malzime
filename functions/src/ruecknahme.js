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

/* So lange wartet die Hilfe hoechstens — auf das Loeschen wie auf die
   Freigabe. Die Freigabe ist eine Transaktion auf dem EINEN Zaehlerdokument;
   unter Andrang kann Firestore dort lange auf die Sperre warten (counter.js,
   Zeitlimit am Einlass). Das Loeschen geht an den Speicher und hat keine
   eigene Zeitgrenze. Die Aufrufer haben kurze Zeitgrenzen und halten eine
   Antwort an einen wartenden Menschen zurueck. Nach dieser Zeit laeuft der
   Vorgang weiter, und eine Warnung sagt, dass nicht auf ihn gewartet wurde.
   BLEIBT IM CODE — keine Stellschraube des Betriebs: Der Wert muss nur unter
   den Zeitgrenzen der Aufrufer bleiben (Statusabfrage, Aufraeumdienst). */
const WARTEN_HOECHSTENS_MS = 5000;
const ZU_LANGE = Symbol("zu-lange");

/** Wartet hoechstens WARTEN_HOECHSTENS_MS auf `vorgang`; dauert er laenger, kommt `ersatz` zurueck und eine Warnzeile. */
async function hoechstens(vorgang, warnung, ersatz) {
  let uhr = null;
  const zuLange = new Promise((fertig) => {
    uhr = setTimeout(() => fertig(ZU_LANGE), WARTEN_HOECHSTENS_MS);
  });
  const ergebnis = await Promise.race([vorgang, zuLange]);
  clearTimeout(uhr);
  if (ergebnis !== ZU_LANGE) return ergebnis;
  console.warn(JSON.stringify({ severity: "WARNING", warning: warnung }));
  return ersatz;
}

/**
 * Loescht das Foto und gibt den Platz im Stundenfenster frei. Beides beginnt
 * SOFORT und haengt nicht voneinander ab; gewartet wird auf jedes hoechstens
 * fuenf Sekunden. Wirft nie.
 *
 * WARUM NICHT NACHEINANDER (07./08.10.2026): Stand die Freigabe vorn und hing
 * sie, blieb das Foto eines schon verworfenen Auftrags bis zur
 * 2-Stunden-Loeschung liegen — einen verworfenen Auftrag fasst der
 * Aufraeumdienst vorher nicht mehr an. Stand das Loeschen vorn und hing es,
 * begann die Freigabe nie, und nichts meldete es. Das Foto ist das, was nicht
 * liegen bleiben darf; ein Platz, der nicht zurueckkommt, kostet hoechstens
 * 60 Minuten Kapazitaet.
 *
 * @param {{ zaehlerStempel?: number, imagePath?: string|null }} auftrag
 *   die Marke des Einlasses und der Pfad des Fotos (ein Auftragsdokument
 *   passt so, wie es ist). Ohne Pfad wird nur der Platz freigegeben.
 * @returns {Promise<boolean>} ob das Foto weg ist (wie deleteImage: `true`
 *   auch, wenn es keines gab; `false` auch, wenn nicht darauf gewartet wurde)
 */
async function belegtesFreigeben(auftrag) {
  /* Beide Funktionen fangen ihre Fehler selbst (deleteImage liefert dann
     `false`, der Zaehler meldet `release-slot-error`). Sollte eine je werfen,
     darf die andere nicht daran haengen. */
  const loeschen = auftrag.imagePath
    ? Promise.resolve()
        .then(() => deleteImage(auftrag.imagePath))
        .catch(() => false)
    : Promise.resolve(true);
  const freigabe = Promise.resolve()
    .then(() => releaseHourlySlot(auftrag.zaehlerStempel))
    .catch(() => {});
  const [fotoWeg] = await Promise.all([
    hoechstens(loeschen, "foto-loeschen-nicht-abgewartet", false),
    hoechstens(freigabe, "release-slot-nicht-abgewartet", undefined),
  ]);
  return fotoWeg;
}

module.exports = { belegtesFreigeben, _WARTEN_HOECHSTENS_MS: WARTEN_HOECHSTENS_MS };
