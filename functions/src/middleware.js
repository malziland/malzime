const rateState = new Map();
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_RATE_ENTRIES = 10000;

function getClientIp(req) {
  /* SEC-001: req.ip wird von Express/Firebase korrekt aus dem Load-Balancer-Header
     geparst. Manuelles x-forwarded-for-Parsing ist spoofbar (Angreifer setzt
     eigenen Wert als ersten Eintrag). */
  return req.ip || "unknown";
}

function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of rateState) {
    if (now > entry.resetAt) rateState.delete(key);
  }
}

/**
 * Adress-Limit.
 *
 * Grenze und Zeitfenster kommen seit 30.08.2026 aus dem Einstellungssatz und
 * werden als Parameter hereingereicht. Bewusst NICHT selbst aus der Datenbank
 * gelesen: Diese Funktion sitzt im Eingang jeder Anfrage und muss synchron und
 * ohne Netzzugriff bleiben. Die Aufrufer sind ohnehin asynchron und holen die
 * Werte einmal.
 *
 * Fehlen die Werte, gelten die Konstanten aus config.js. Anders als bei den
 * Zeitgrenzen ist der Rueckfall hier richtig: Das Adress-Limit ist eine
 * Schutzgrenze — ohne sie waere der Eingang offen.
 */
function checkRateLimit(key, grenze, fensterMs) {
  /* Grenze und Fenster sind Pflicht — sie kommen aus dem Einstellungssatz.
     Ein Rueckfall auf eine Konstante waere eine zweite Definition derselben
     Zahl gewesen. */
  if (typeof grenze !== "number" || !(grenze > 0)) throw new Error("checkRateLimit: adressLimit fehlt");
  if (typeof fensterMs !== "number" || !(fensterMs > 0)) throw new Error("checkRateLimit: adressfensterMs fehlt");
  const limit = grenze;
  const fenster = fensterMs;
  cleanupExpired();
  const current = Date.now();
  const entry = rateState.get(key);
  if (!entry || current > entry.resetAt) {
    /* LRU-Cap: Wenn Map voll, ältesten Eintrag entfernen */
    if (rateState.size >= MAX_RATE_ENTRIES && !rateState.has(key)) {
      const oldest = rateState.keys().next().value;
      rateState.delete(oldest);
    }
    rateState.set(key, { count: 1, resetAt: current + fenster });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

module.exports = { getClientIp, checkRateLimit };
