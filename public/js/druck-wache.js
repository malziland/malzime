/* ── Druck-Wache: meldet eine leere Seite nach dem Druckdialog ──────────────
   NUTZER-FUND 2026-08-18: Nach „PDF speichern" → Abbrechen war die Seite im
   Beast-Modus schwarz und leer; erst ein Neuladen brachte sie zurueck. Headless
   ist das nicht reproduzierbar — weder ueber das Druck-Stylesheet noch in
   Chromium oder WebKit. Statt eine Vermutung als Behebung auszuliefern, wird der
   Fall MESSBAR gemacht.

   BUG-2026-08-20-02: Die erste Fassung stand direkt in app.js und uebergab einen
   STRING als Fehler plus Kontextfelder, die `logClientError` gar nicht kennt
   (`hoehe`, `display`, `modus` …). Der Logger baut seinen Rumpf aus `error.name`
   / `error.message` und einer festen Feldliste — angekommen waere
   `{errorName:"Error", errorMessage:"", phase:"unknown"}`, also genau nichts.
   Das Instrument war blind, und niemand haette es gemerkt, weil kein Test den
   Meldeweg abdeckte.

   Deshalb liegt die Logik jetzt hier: als reine Funktion, die ihre Meldefunktion
   hereingereicht bekommt und damit pruefbar ist. Die Messwerte reisen in der
   Fehlermeldung (serverseitig 500 Zeichen), der Filterschluessel in `phase`
   (50 Zeichen) und eine Kurzform in `errorDetail` (60 Zeichen). */

/** Ab dieser Hoehe in Bildpunkten gilt der Ergebnisbereich als sichtbar. */
const MINDESTHOEHE_PX = 50;

/**
 * Prueft, ob der Ergebnisbereich nach dem Druckdialog unsichtbar geblieben ist,
 * und meldet ihn mit allen Messwerten.
 *
 * @param {(fehler: Error, kontext: object) => void} melde Meldefunktion (logClientError).
 * @param {Document} [dok] Dokument, gegen das gemessen wird.
 * @returns {boolean} true, wenn gemeldet wurde.
 */
export function pruefeSeiteNachDruck(melde, dok = document) {
  const panel = dok.getElementById("resultsPanel");
  if (!panel) return false;

  const kasten = panel.getBoundingClientRect();
  const sicht = dok.defaultView || window;
  const stil = sicht.getComputedStyle(panel);
  const unsichtbar = kasten.height < MINDESTHOEHE_PX || stil.display === "none" || stil.visibility === "hidden";
  if (!unsichtbar) return false;

  const messwerte = {
    hoehe: Math.round(kasten.height),
    display: stil.display,
    sichtbarkeit: stil.visibility,
    deckkraft: stil.opacity,
    modus: dok.documentElement.getAttribute("data-mode"),
    thema: dok.documentElement.getAttribute("data-theme"),
    bodyHoehe: dok.body ? dok.body.scrollHeight : 0,
    druckhinweise: dok.querySelectorAll(".print-note").length,
  };
  const angaben = Object.entries(messwerte)
    .map(([schluessel, wert]) => `${schluessel}=${wert}`)
    .join(" ");

  const fehler = new Error(`Ergebnisbereich nach Druckdialog unsichtbar — ${angaben}`);
  fehler.name = "DruckAbbruchLeereSeite";
  melde(fehler, {
    phase: "druck-abbruch-seite-leer",
    /* Kurzform fuers schnelle Filtern im Log; die vollstaendigen Angaben stehen
       in der Meldung selbst. */
    errorDetail: `h=${messwerte.hoehe} d=${messwerte.display} v=${messwerte.sichtbarkeit}`.slice(0, 60),
  });
  return true;
}

/**
 * Haengt die Wache an `afterprint`. Zwei Bildschirmrahmen Abstand, damit der
 * Browser fertig gezeichnet hat.
 */
export function initDruckWache(melde, ziel = window) {
  ziel.addEventListener("afterprint", () => {
    ziel.requestAnimationFrame(() => ziel.requestAnimationFrame(() => pruefeSeiteNachDruck(melde, ziel.document)));
  });
}
