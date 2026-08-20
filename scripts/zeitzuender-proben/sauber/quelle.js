/* Probe: fester Zeitpunkt, gegen den zur Laufzeit die echte Uhr rechnet. */
const AUSGELIEFERT = Date.parse("2026-08-12T00:00:00Z");
const FRIST_MS = 9 * 24 * 60 * 60 * 1000;
function pruefe() {
  return Date.now() - AUSGELIEFERT > FRIST_MS ? "meldung" : "still";
}
module.exports = { pruefe };
