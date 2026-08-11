const { getStats, getMaintenanceStatus, leseRealitaetsCheck } = require("./counter");

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
  const [data, maintenance, realitaetsCheck] = await Promise.all([
    getStats(),
    getMaintenanceStatus(),
    /* Realitäts-Check (v3.1): anonymer Gesamtzähler fuer den Vergleichs-
       balken — { eingaben, mittelProzent }; mittelProzent ist null, solange
       es keine Eingaben gibt. */
    leseRealitaetsCheck(),
  ]);
  if (!data) {
    res.status(503).json({ error: "Stats unavailable" });
    return;
  }
  res.json({ ...data, maintenance, realitaetsCheck, useQueue: true });
}

module.exports = { handleStats };
