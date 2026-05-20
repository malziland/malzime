const { getStats, getMaintenanceStatus } = require("./counter");
const { isQueueEnabled } = require("./feature-flags");

async function handleStats(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  /* `useQueue` reist auf der Stats-Antwort mit — das Frontend holt sie ohnehin
     beim Seitenstart und entscheidet damit zwischen Queue- und Sync-Pfad. */
  const [data, maintenance, useQueue] = await Promise.all([getStats(), getMaintenanceStatus(), isQueueEnabled()]);
  if (!data) {
    res.status(503).json({ error: "Stats unavailable" });
    return;
  }
  res.json({ ...data, maintenance, useQueue });
}

module.exports = { handleStats };
