"use strict";

/**
 * oeffentliche-huelle.js — was fuer JEDE oeffentliche Schnittstelle gilt.
 *
 * index.js umhuellt damit jede Function, die es mit `invoker: "public"`
 * anlegt. Zwei Aufgaben, beide unabhaengig vom einzelnen Handler:
 * keine Antwort im Zwischenspeicher des Browsers, keine gepackten Anfragen.
 */

/* PRIV-2026-09-10-06: Keine Antwort unserer oeffentlichen Schnittstellen darf
   im Zwischenspeicher des Browsers liegen bleiben — allen voran das fertige
   Profil aus job-status. Die Datenschutzerklaerung sagt, dass nach dem
   Schliessen der Seite im Browser nichts mehr da ist; ohne diese Kopfzeile war
   das nicht abgesichert.

   BEWUSST AN EINER STELLE fuer alle und nicht in jedem Handler: Eine neue
   Schnittstelle bekommt die Kopfzeile, sobald index.js sie mit dieser Huelle
   einhaengt. kein-zwischenspeicher.test.js ruft jede Function mit
   `invoker: "public"` auf und wird rot, sobald eine ohne `no-store` antwortet.

   SEC-2026-10-03-21: An derselben Stelle werden GEPACKTE Anfragen abgewiesen
   (Kopfzeile `Content-Encoding`). Der eigene Browser schickt nie eine; wer es
   tut, will einen winzigen Rumpf auf Hunderte Megabyte aufblaehen lassen.
   EHRLICHE GRENZE: Die Laufzeit entpackt den Rumpf, BEVOR diese Funktion
   laeuft (am Laufzeit-Rahmen gelesen und lokal gemessen; feste Grenze 1024 MB,
   nicht einstellbar) — der Speicher ist dann schon belegt. Verhindert wird
   nur, dass das Programm mit dem Rumpf weiterarbeitet, und der Versuch steht
   im Protokoll. docs/SECURITY-MODEL.md, Restrisiko 9;
   gepackte-anfragen.test.js. */
function ohneZwischenspeicher(handler) {
  return (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const kodierung = String((req.headers && req.headers["content-encoding"]) || "")
      .trim()
      .toLowerCase();
    if (kodierung && kodierung !== "identity") {
      /* Nur die Groesse nach dem Entpacken — keine Adresse, kein Inhalt. */
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          warning: "gepackte-anfrage-abgewiesen",
          entpacktBytes: req.rawBody ? req.rawBody.length : null,
        })
      );
      res.status(415).json({ error: "Content-Encoding not supported" });
      return undefined;
    }
    return handler(req, res);
  };
}

module.exports = { ohneZwischenspeicher };
