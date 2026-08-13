const { getStats, getMaintenanceStatus, leseRealitaetsCheck } = require("./counter");
const { isSprachumschalterEnabled } = require("./feature-flags");

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
  const [data, maintenance, realitaetsCheck, sprachumschalter] = await Promise.all([
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
  ]);
  if (!data) {
    res.status(503).json({ error: "Stats unavailable" });
    return;
  }
  res.json({ ...data, maintenance, realitaetsCheck, useQueue: true, sprachumschalter });
}

module.exports = { handleStats };
