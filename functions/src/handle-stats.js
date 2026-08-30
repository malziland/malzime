const { getStats, getMaintenanceStatus, leseRealitaetsCheck } = require("./counter");
const { isSprachumschalterEnabled } = require("./feature-flags");
const { geltendeWerte } = require("./betriebsprofil");

async function handleStats(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  /* ÜBERGANG (v2.10): `useQueue: true` steht hier nur noch fuer Besucher mit
     einer alten, zwischengespeicherten Seite. Deren Code prueft das Feld und
     wuerde ohne es auf den synchronen Weg fallen, den es nicht mehr gibt.
     Kann ein paar Wochen nach dem Umstieg ersatzlos weg.
     Frueherer Kommentar: das Frontend holt die Antwort ohnehin
     beim Seitenstart und entscheidet damit zwischen Queue- und Sync-Pfad. */
  const [data, maintenance, realitaetsCheck, sprachumschalter, betrieb] = await Promise.all([
    getStats(),
    getMaintenanceStatus(),
    /* Realitäts-Check (v3.1): anonymer Gesamtzähler fuer den Vergleichs-
       balken — { eingaben, mittelProzent }; mittelProzent ist null, solange
       es keine Eingaben gibt. */
    leseRealitaetsCheck(),
    /* v3.3: Merkmals-Schloss fuer den DE/EN-Umschalter. Das Frontend holt
       diese Antwort ohnehin beim Seitenstart; ein eigener Endpunkt waere ein
       zusaetzlicher Netzweg fuer ein einziges Ja/Nein. Faellt der Aufruf aus,
       gilt `false` — dann entsteht das Bedienelement gar nicht. */
    isSprachumschalterEnabled().catch(() => false),
    /* Geltende Betriebswerte. Zwei Gruende, sie hier mitzuliefern:

       1. GEDULD DES BROWSERS. Die Wartewerte im Browser muessen laenger sein
          als das, was das Backend braucht. Solange beide Seiten getrennt
          eingestellt sind, kann eine Aenderung der Zeitgrenze die Ansage im
          Browser still falsch machen — genau das waere am 28.08. passiert,
          haetten wir statt 300 s auf 600 s erhoeht.

       2. SICHTBARKEIT. Ohne diese Angabe waere von aussen nicht feststellbar,
          welches Profil tatsaechlich gilt. Ein Schalter, dessen Stellung
          niemand pruefen kann, ist schlimmer als keiner.

       Faellt der Aufruf aus, fehlt das Feld — das Frontend nutzt dann seine
       eigenen Werte wie bisher. */
    geltendeWerte().catch(() => null),
  ]);
  if (!data) {
    res.status(503).json({ error: "Stats unavailable" });
    return;
  }
  /* Nur die Werte, die der Browser wirklich braucht — nicht das ganze Profil.
     Die Zeitgrenze sagt ihm, wie lange er mindestens durchhalten muss. */
  const betriebswerte = betrieb
    ? {
        profil: betrieb.profil || null,
        quelle: betrieb.quelle,
        analyseZeitgrenzeMs: betrieb.werte.singleLargeTimeoutMs,
      }
    : undefined;
  res.json({ ...data, maintenance, realitaetsCheck, useQueue: true, sprachumschalter, betrieb: betriebswerte });
}

module.exports = { handleStats };
